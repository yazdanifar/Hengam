// Single-occurrence edits/deletes of a recurring event must reach Google even when no pull
// has ever revealed that occurrence's own Google "instance" id — the sync engine looks it up
// directly via events.instances instead of waiting.
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../support/db'
import { EventsRepo } from '@main/repo/events'
import { SyncCalendarsRepo } from '@main/repo/syncCalendars'
import { MetaRepo } from '@main/repo/meta'
import { GoogleAuth } from '@main/sync/GoogleAuth'
import { GoogleCalendarClient } from '@main/sync/GoogleCalendarClient'
import { SyncService } from '@main/sync/SyncService'
import type { GoogleOAuthConfig } from '@main/sync/googleConfig'
import { FakeClock } from '../support/fakes/FakeClock'
import { FakeHttpClient } from '../support/fakes/FakeHttpClient'
import { FakeSecretStore } from '../support/fakes/FakeSecretStore'
import { FakeLoopbackServer } from '../support/fakes/FakeLoopbackServer'
import { FakeBrowserLauncher } from '../support/fakes/FakeBrowserLauncher'
import { FakePowerEvents } from '../support/fakes/FakePowerEvents'
import { SpyRendererBridge } from '../support/fakes/SpyRendererBridge'
import { FakeGoogleCalendar } from '../support/fakes/FakeGoogleCalendar'
import { addJalaliMonths, toGregorian, toJalali } from '@shared/jalali'
import { toGoogleEvent } from '@main/sync/mapper'

/** The 2nd (index 1) monthly occurrence of a series starting at `startTs`, computed the same
 *  way the mapper does, so a test's skipped date actually lands on a generated RDATE. */
function secondMonthlyOccurrence(startTs: number): number {
  const startJ = toJalali(new Date(startTs))
  const occJ = addJalaliMonths(startJ.jy, startJ.jm, startJ.jd, 1)
  const timeOfDay = startTs - new Date(startTs).setHours(0, 0, 0, 0)
  return toGregorian(occJ.jy, occJ.jm, occJ.jd).getTime() + timeOfDay
}

const cfg: GoogleOAuthConfig = {
  clientId: 'id',
  clientSecret: 'secret',
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
  apiBase: 'https://www.googleapis.com/calendar/v3',
  scopes: []
}

const PALETTE = { event: { '1': { background: '#3b82f6', foreground: '#fff' } } }

function setup() {
  const db = createTestDb()
  const clock = new FakeClock('2026-09-23T10:00:00')
  const events = new EventsRepo(db, clock)
  const calendars = new SyncCalendarsRepo(db)
  const meta = new MetaRepo(db)
  const http = new FakeHttpClient()
  const secrets = new FakeSecretStore()
  const auth = new GoogleAuth(cfg, http, secrets, new FakeBrowserLauncher(), new FakeLoopbackServer(), clock)
  const client = new GoogleCalendarClient(cfg, http, auth, clock)
  const google = new FakeGoogleCalendar().install(http)
  http.onJson(/\/colors$/, 200, PALETTE)
  const sync = new SyncService(clock, new FakePowerEvents(), auth, client, events, calendars, meta, new SpyRendererBridge(), true)
  return { db, clock, events, calendars, meta, http, secrets, google, sync }
}
type Ctx = ReturnType<typeof setup>

async function connectAccount(ctx: Ctx) {
  ctx.http.onJson(/token/, 200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 })
  await ctx.secrets.set('google.refresh_token', 'rt1')
  await ctx.secrets.set('google.account', JSON.stringify({ email: 'me@x.com' }))
  await ctx.calendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
}

describe('pushing single-occurrence edits of a recurring event', () => {
  it('deletes a locally skipped occurrence on Google without a prior pull', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const start = 10 * 86400_000
    const ev = ctx.events.create({
      title: 'weekly',
      color: '#3b82f6',
      startTs: start,
      endTs: start + 3600_000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    const parent = ctx.google.seed('primary', {
      id: 'g1',
      summary: 'weekly',
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(start + 3600_000).toISOString() }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: parent.id, etag: parent.etag })
    const occTs = start + 2 * 86400_000
    ctx.google.seed('primary', {
      id: 'gi2',
      summary: 'weekly',
      recurringEventId: 'g1',
      originalStartTime: { dateTime: new Date(occTs).toISOString() },
      start: { dateTime: new Date(occTs).toISOString() },
      end: { dateTime: new Date(occTs + 3600_000).toISOString() }
    })

    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: occTs, kind: 'skip' })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(ctx.google.live('primary').find((e) => e.id === 'gi2')).toBeUndefined()
    expect(ctx.events.listDirtyExceptions()).toHaveLength(0)
  })

  it('patches a locally overridden occurrence, keeping the parent reminders', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const start = 10 * 86400_000
    const ev = ctx.events.create({
      title: 'weekly',
      color: '#3b82f6',
      startTs: start,
      endTs: start + 3600_000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 },
      reminders: [10]
    })
    const parent = ctx.google.seed('primary', {
      id: 'g1',
      summary: 'weekly',
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(start + 3600_000).toISOString() }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: parent.id, etag: parent.etag })
    const occTs = start + 2 * 86400_000
    ctx.google.seed('primary', {
      id: 'gi2',
      summary: 'weekly',
      recurringEventId: 'g1',
      originalStartTime: { dateTime: new Date(occTs).toISOString() },
      start: { dateTime: new Date(occTs).toISOString() },
      end: { dateTime: new Date(occTs + 3600_000).toISOString() }
    })

    ctx.events.addException({
      eventId: ev.id,
      occurrenceStartTs: occTs,
      kind: 'override',
      override: { title: 'moved occurrence', startTs: occTs + 3600_000, endTs: occTs + 2 * 3600_000 }
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    const live = ctx.google.live('primary').find((e) => e.id === 'gi2')!
    expect(live.summary).toBe('moved occurrence')
    expect(live.reminders?.overrides?.[0]).toMatchObject({ minutes: 10 })
    expect(ctx.events.listDirtyExceptions()).toHaveLength(0)
  })

  it('marks an exception clean with no request loop when Google has no such occurrence', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const start = 10 * 86400_000
    const ev = ctx.events.create({
      title: 'weekly',
      color: '#3b82f6',
      startTs: start,
      endTs: start + 3600_000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    const parent = ctx.google.seed('primary', {
      id: 'g1',
      summary: 'weekly',
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(start + 3600_000).toISOString() }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: parent.id, etag: parent.etag })
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: start + 2 * 86400_000, kind: 'skip' })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(ctx.events.listDirtyExceptions()).toHaveLength(0)
  })

  it('a parent with no Google id yet leaves its exceptions dirty and makes no instance lookup', async () => {
    const ctx = setup()
    // No connected calendar at all, so pushAll has nowhere to insert the parent.
    ctx.http.onJson(/token/, 200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 })
    await ctx.secrets.set('google.refresh_token', 'rt1')
    await ctx.secrets.set('google.account', JSON.stringify({ email: 'me@x.com' }))
    const start = 10 * 86400_000
    const ev = ctx.events.create({
      title: 'weekly',
      color: '#3b82f6',
      startTs: start,
      endTs: start + 3600_000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: start + 2 * 86400_000, kind: 'skip' })
    // No default target calendar exists (connectAccount's normal upsertMany was skipped for
    // this test), so the parent's own insert has nowhere to go and it never gets a googleId;
    // the exception must not attempt an instance lookup in the meantime.
    let instanceLookups = 0
    ctx.http.on(/instances/, () => {
      instanceLookups++
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(instanceLookups).toBe(0)
    expect(ctx.events.listDirtyExceptions()).toHaveLength(1)
  })

  it('a second sync sends no further exception requests once both are clean', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const start = 10 * 86400_000
    const ev = ctx.events.create({
      title: 'weekly',
      color: '#3b82f6',
      startTs: start,
      endTs: start + 3600_000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    const parent = ctx.google.seed('primary', {
      id: 'g1',
      summary: 'weekly',
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(start + 3600_000).toISOString() }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: parent.id, etag: parent.etag })
    const skipTs = start + 2 * 86400_000
    const overrideTs = start + 3 * 86400_000
    ctx.google.seed('primary', {
      id: 'gi-skip',
      summary: 'weekly',
      recurringEventId: 'g1',
      originalStartTime: { dateTime: new Date(skipTs).toISOString() },
      start: { dateTime: new Date(skipTs).toISOString() },
      end: { dateTime: new Date(skipTs + 3600_000).toISOString() }
    })
    ctx.google.seed('primary', {
      id: 'gi-override',
      summary: 'weekly',
      recurringEventId: 'g1',
      originalStartTime: { dateTime: new Date(overrideTs).toISOString() },
      start: { dateTime: new Date(overrideTs).toISOString() },
      end: { dateTime: new Date(overrideTs + 3600_000).toISOString() }
    })
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: skipTs, kind: 'skip' })
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: overrideTs, kind: 'override', override: { title: 'x' } })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })
    await ctx.sync.syncNow('manual')
    expect(ctx.events.listDirtyExceptions()).toHaveLength(0)

    let secondRunRequests = 0
    ctx.http.on(/instances|events\/gi-/, () => {
      secondRunRequests++
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok2' })

    await ctx.sync.syncNow('manual')

    expect(secondRunRequests).toBe(0)
  })
  it('a local edit to an occurrence cancelled on Google meanwhile restores it with the edit', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const start = 10 * 86400_000
    const ev = ctx.events.create({
      title: 'daily',
      color: '#3b82f6',
      startTs: start,
      endTs: start + 3600_000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    const parent = ctx.google.seed('primary', {
      id: 'g1',
      summary: 'daily',
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(start + 3600_000).toISOString() }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: parent.id, etag: parent.etag })
    const occTs = start + 2 * 86400_000
    // Deleted on Google (another device / the web UI) before this device's edit got pushed.
    ctx.google.seed('primary', {
      id: 'gi2',
      summary: 'daily',
      status: 'cancelled',
      recurringEventId: 'g1',
      originalStartTime: { dateTime: new Date(occTs).toISOString() },
      start: { dateTime: new Date(occTs).toISOString() },
      end: { dateTime: new Date(occTs + 3600_000).toISOString() }
    })
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: occTs, kind: 'override', override: { title: 'edited here' } })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    const live = ctx.google.live('primary').find((e) => e.id === 'gi2')
    expect(live).toMatchObject({ summary: 'edited here', status: 'confirmed' })
    expect(ctx.events.listDirtyExceptions()).toHaveLength(0)
  })
})

describe('Jalali monthly/yearly series and locally skipped occurrences', () => {
  it('leaves a locally skipped date out of the RDATE list sent to Google', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const ev = ctx.events.create({
      title: 'monthly',
      color: '#3b82f6',
      startTs: new Date('2026-01-01T09:00:00Z').getTime(),
      endTs: new Date('2026-01-01T10:00:00Z').getTime(),
      allDay: false,
      rrule: { freq: 'monthly', interval: 1, count: 4 }
    })
    const parent = ctx.google.seed('primary', {
      id: 'g1',
      summary: 'monthly',
      start: { dateTime: new Date('2026-01-01T09:00:00Z').toISOString() },
      end: { dateTime: new Date('2026-01-01T10:00:00Z').toISOString() }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: parent.id, etag: parent.etag })

    // Skip the 2nd occurrence (month index 1 from start).
    const secondOccTs = secondMonthlyOccurrence(new Date('2026-01-01T09:00:00Z').getTime())
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: secondOccTs, kind: 'skip' })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    const live = ctx.google.live('primary').find((e) => e.id === 'g1')!
    const rdateLine = live.recurrence?.find((l) => l.startsWith('RDATE:')) ?? ''
    expect(rdateLine).not.toContain(new Date(secondOccTs).toISOString().replace(/\.\d{3}Z$/, 'Z'))
  })

  it('a later sync does not resurrect a skipped date once it is already excluded', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const ev = ctx.events.create({
      title: 'monthly',
      color: '#3b82f6',
      startTs: new Date('2026-01-01T09:00:00Z').getTime(),
      endTs: new Date('2026-01-01T10:00:00Z').getTime(),
      allDay: false,
      rrule: { freq: 'monthly', interval: 1, count: 4 }
    })
    const parent = ctx.google.seed('primary', {
      id: 'g1',
      summary: 'monthly',
      start: { dateTime: new Date('2026-01-01T09:00:00Z').toISOString() },
      end: { dateTime: new Date('2026-01-01T10:00:00Z').toISOString() }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: parent.id, etag: parent.etag })
    const secondOccTs = secondMonthlyOccurrence(new Date('2026-01-01T09:00:00Z').getTime())
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: secondOccTs, kind: 'skip' })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })
    await ctx.sync.syncNow('manual')

    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok2' })
    await ctx.sync.syncNow('manual') // parent no longer dirty; should not re-push at all

    const live = ctx.google.live('primary').find((e) => e.id === 'g1')!
    const rdateLine = live.recurrence?.find((l) => l.startsWith('RDATE:')) ?? ''
    expect(rdateLine).not.toContain(new Date(secondOccTs).toISOString().replace(/\.\d{3}Z$/, 'Z'))
  })

  it('a skip added while the parent patch is already in flight is not marked clean by that response', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const startTs = new Date('2026-01-01T09:00:00Z').getTime()
    const ev = ctx.events.create({
      title: 'monthly',
      color: '#3b82f6',
      startTs,
      endTs: startTs + 3600_000,
      allDay: false,
      rrule: { freq: 'monthly', interval: 1, count: 4 }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1', etag: '"e0"' })
    ctx.events.update(ev.id, { title: 'monthly (renamed)' }) // dirties the parent, no skip yet

    const secondOccTs = secondMonthlyOccurrence(startTs)
    ctx.http.on(/events\/g1$/, (_url, init) => {
      if (init?.method !== 'PATCH') throw new Error('unexpected ' + init?.method)
      // The occurrence is skipped after this push read the row but before its response lands.
      ctx.events.addException({ eventId: ev.id, occurrenceStartTs: secondOccTs, kind: 'skip' })
      return new Response(JSON.stringify({ id: 'g1', etag: '"e1"', updated: '2026-09-23T11:00:00.000Z' }), { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    // The skip raced the in-flight push, so the parent must still be dirty — otherwise the
    // skipped date, absent from the body that request sent, would never be re-pushed.
    expect(ctx.events.getById(ev.id)).toMatchObject({ dirty: true })

    let secondPatchBody: string | undefined
    ctx.http.on(/events\/g1$/, (_url, init) => {
      if (init?.method !== 'PATCH') throw new Error('unexpected ' + init?.method)
      secondPatchBody = init.body as string
      return new Response(JSON.stringify({ id: 'g1', etag: '"e2"', updated: '2026-09-23T12:00:00.000Z' }), { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok2' })
    await ctx.sync.syncNow('manual')

    const rdateLine = (JSON.parse(secondPatchBody!).recurrence as string[]).find((l) => l.startsWith('RDATE:')) ?? ''
    expect(rdateLine).not.toContain(new Date(secondOccTs).toISOString().replace(/\.\d{3}Z$/, 'Z'))
    expect(ctx.events.getById(ev.id)).toMatchObject({ dirty: false })
  })

  it('a date skipped on another device (missing from the pulled RDATE list) is skipped here too, and stays out on re-push', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const startTs = new Date('2026-01-01T09:00:00Z').getTime()
    const secondOccTs = secondMonthlyOccurrence(startTs)
    const rrule = { freq: 'monthly', interval: 1, count: 4 } as const
    // What the other device sent after skipping the 2nd occurrence.
    const remote = toGoogleEvent({ title: 'monthly', startTs, endTs: startTs + 3600_000, allDay: false, rrule, skipStarts: [secondOccTs] })
    ctx.http.onJson(/\/events\?/, 200, {
      items: [{ ...remote, id: 'g1', etag: '"e0"', updated: '2026-09-23T09:00:00.000Z' }],
      nextSyncToken: 'tok1'
    })

    await ctx.sync.syncNow('manual')

    const local = ctx.events.findByGoogleId('primary', 'g1')!
    expect(ctx.events.listExceptions(local.id)).toEqual([
      expect.objectContaining({ occurrenceStartTs: secondOccTs, kind: 'skip' })
    ])
    const starts = ctx.events.rangeQuery(startTs - 1, startTs + 200 * 86400_000).map((o) => o.startTs)
    expect(starts).toHaveLength(3)
    expect(starts).not.toContain(secondOccTs)

    // This device now edits the series: its re-push must not put the skipped date back.
    ctx.events.update(local.id, { title: 'monthly (renamed)' })
    let patchBody: string | undefined
    ctx.http.on(/events\/g1$/, (_url, init) => {
      patchBody = init?.body as string
      return new Response(JSON.stringify({ id: 'g1', etag: '"e1"', updated: '2026-09-23T11:00:00.000Z' }), { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok2' })
    await ctx.sync.syncNow('manual')

    const rdateLine = (JSON.parse(patchBody!).recurrence as string[]).find((l) => l.startsWith('RDATE:')) ?? ''
    expect(rdateLine.split(',')).toHaveLength(2)
    expect(rdateLine).not.toContain(new Date(secondOccTs).toISOString().replace(/\.\d{3}Z$/, 'Z'))
  })

  it('a local edit to a date another device skipped puts the date back on Google, then patches it', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const startTs = new Date('2026-01-01T09:00:00Z').getTime()
    const ev = ctx.events.create({
      title: 'monthly',
      color: '#3b82f6',
      startTs,
      endTs: startTs + 3600_000,
      allDay: false,
      rrule: { freq: 'monthly', interval: 1, count: 4 }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1', etag: '"e0"' })
    const secondOccTs = secondMonthlyOccurrence(startTs)
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: secondOccTs, kind: 'override', override: { title: 'edited here' } })

    // Google's RDATE list lacks the date (skipped elsewhere) until the parent is re-pushed.
    let parentPatch: { body: string; ifMatch?: string } | undefined
    let instancePatch: string | undefined
    ctx.http.on(/events\/g1\/instances/, () =>
      new Response(JSON.stringify({ items: parentPatch ? [{ id: 'g1_occ2', etag: '"i1"' }] : [] }), { status: 200 })
    )
    ctx.http.on(/events\/g1$/, (_url, init) => {
      parentPatch = { body: init?.body as string, ifMatch: (init?.headers as Record<string, string>)?.['If-Match'] }
      return new Response(JSON.stringify({ id: 'g1', etag: '"e1"', updated: '2026-09-23T11:00:00.000Z' }), { status: 200 })
    })
    ctx.http.on(/events\/g1_occ2$/, (_url, init) => {
      instancePatch = init?.body as string
      return new Response(JSON.stringify({ id: 'g1_occ2', etag: '"i2"' }), { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    const rdateLine = (JSON.parse(parentPatch!.body).recurrence as string[]).find((l) => l.startsWith('RDATE:')) ?? ''
    expect(rdateLine).toContain(new Date(secondOccTs).toISOString().replace(/\.\d{3}Z$/, 'Z'))
    expect(parentPatch!.ifMatch).toBe('"e0"')
    expect(JSON.parse(instancePatch!)).toMatchObject({ summary: 'edited here', status: 'confirmed' })
    expect(ctx.events.getById(ev.id)).toMatchObject({ dirty: false, etag: '"e1"' })
    expect(ctx.events.listExceptions(ev.id)).toEqual([
      expect.objectContaining({ occurrenceStartTs: secondOccTs, kind: 'override' })
    ])
    expect(ctx.events.listDirtyExceptions()).toHaveLength(0)
  })
})

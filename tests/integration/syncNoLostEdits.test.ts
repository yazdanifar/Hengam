// A pull or a push response arriving late must never silently discard a local change that
// raced it: neither an edit sitting unsent, nor one made while a request was in flight.
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../support/db'
import { EventsRepo } from '@main/repo/events'
import { SyncCalendarsRepo } from '@main/repo/syncCalendars'
import { MetaRepo } from '@main/repo/meta'
import { GoogleAuth } from '@main/sync/GoogleAuth'
import { GoogleCalendarClient } from '@main/sync/GoogleCalendarClient'
import { SyncService, googleIdFor } from '@main/sync/SyncService'
import type { GoogleOAuthConfig } from '@main/sync/googleConfig'
import { FakeClock } from '../support/fakes/FakeClock'
import { FakeHttpClient } from '../support/fakes/FakeHttpClient'
import { FakeSecretStore } from '../support/fakes/FakeSecretStore'
import { FakeLoopbackServer } from '../support/fakes/FakeLoopbackServer'
import { FakeBrowserLauncher } from '../support/fakes/FakeBrowserLauncher'
import { FakePowerEvents } from '../support/fakes/FakePowerEvents'
import { SpyRendererBridge } from '../support/fakes/SpyRendererBridge'

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
  http.onJson(/\/colors$/, 200, PALETTE)
  const sync = new SyncService(clock, new FakePowerEvents(), auth, client, events, calendars, meta, new SpyRendererBridge(), true)
  return { db, clock, events, calendars, meta, http, secrets, sync }
}
type Ctx = ReturnType<typeof setup>

async function connectAccount(ctx: Ctx) {
  ctx.http.onJson(/token/, 200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 })
  await ctx.secrets.set('google.refresh_token', 'rt1')
  await ctx.secrets.set('google.account', JSON.stringify({ email: 'me@x.com' }))
  ctx.calendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
}

describe('a pull never overwrites an unsent local edit', () => {
  it('a row still waiting to be pushed keeps its local content and stays dirty', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const ev = ctx.events.create({ title: 'v1', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1', etag: '"e1"' })
    ctx.events.update(ev.id, { title: 'v2 (local, unsent)' })

    // The push of that edit fails outright (e.g. offline)...
    ctx.http.on(/events\/g1$/, (_url, init) => {
      if (init?.method === 'PATCH') throw new Error('network down')
      return new Response(JSON.stringify({ id: 'g1' }), { status: 200 })
    })
    // ...but a pull still runs in the same pass and reports back our own last-known-good state.
    ctx.http.onJson(/\/events\?/, 200, {
      items: [
        {
          id: 'g1',
          summary: 'v1',
          etag: '"e1"',
          updated: '2026-09-23T09:00:00.000Z',
          start: { dateTime: new Date(1000).toISOString() },
          end: { dateTime: new Date(2000).toISOString() }
        }
      ],
      nextSyncToken: 'tok1'
    })

    const status = await ctx.sync.syncNow('manual')

    expect(status.errorCode).toBeUndefined() // one failed row doesn't fail the whole run
    const loaded = ctx.events.getById(ev.id)!
    expect(loaded.title).toBe('v2 (local, unsent)') // not clobbered by the pull
    expect(loaded.dirty).toBe(true) // still owed to Google

    // Once the network is back, the edit reaches Google on the very next run.
    let patchedTitle: string | undefined
    ctx.http.on(/events\/g1$/, (_url, init) => {
      if (init?.method === 'PATCH') {
        patchedTitle = (JSON.parse(init.body as string) as { summary: string }).summary
        return new Response(JSON.stringify({ id: 'g1', etag: '"e2"', updated: '2026-09-23T11:00:00.000Z' }), { status: 200 })
      }
      throw new Error('unexpected ' + init?.method)
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok2' }) // no stale pull this time
    await ctx.sync.syncNow('manual')

    expect(patchedTitle).toBe('v2 (local, unsent)')
    expect(ctx.events.getById(ev.id)).toMatchObject({ dirty: false, title: 'v2 (local, unsent)' })
  })

  it('an unpushed single-occurrence exception edit is left alone by a pull of the same occurrence', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const ev = ctx.events.create({
      title: 'series',
      color: '#3b82f6',
      startTs: 1000,
      endTs: 2000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    ctx.events.upsertExceptionFromRemote({
      eventId: ev.id,
      occurrenceStartTs: 1500,
      kind: 'override',
      override: { title: 'gx1 remote' },
      googleId: 'gx1',
      etag: '"e1"'
    })
    // A local edit to that same occurrence, not yet pushed.
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'override', override: { title: 'local edit' } })

    ctx.events.upsertExceptionFromRemote({
      eventId: ev.id,
      occurrenceStartTs: 1500,
      kind: 'override',
      override: { title: 'someone else changed it on Google' },
      googleId: 'gx1',
      etag: '"e2"'
    })

    const [exception] = ctx.events.listExceptions(ev.id)
    expect(exception.override?.title).toBe('local edit')
    expect(ctx.events.listDirtyExceptions()).toHaveLength(1)
  })
})

describe('a local change made while a push is in flight is not marked as sent', () => {
  it('editing an event again while its own patch is in flight keeps it dirty and re-sends the newer content', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const ev = ctx.events.create({ title: 'v1', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1', etag: '"e1"' })
    ctx.events.update(ev.id, { title: 'v2' })

    ctx.http.on(/events\/g1$/, (_url, init) => {
      if (init?.method === 'PATCH') {
        // Simulate the race: by the time Google's response comes back, the user has
        // already made a second edit the outgoing PATCH body (for v2) never included.
        ctx.events.update(ev.id, { title: 'v3 (edited mid-flight)' })
        return new Response(JSON.stringify({ id: 'g1', etag: '"e2"', updated: '2026-09-23T11:00:00.000Z' }), { status: 200 })
      }
      return new Response(JSON.stringify({ items: [], nextSyncToken: 'tok1' }), { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    const afterFirstRun = ctx.events.getById(ev.id)!
    expect(afterFirstRun.title).toBe('v3 (edited mid-flight)')
    expect(afterFirstRun.dirty).toBe(true) // the mid-flight edit was never sent — must not be cleared
    expect(afterFirstRun.etag).toBe('"e2"') // identity/etag from the completed request is still recorded

    let secondPatchBody: string | undefined
    ctx.http.on(/events\/g1$/, (_url, init) => {
      if (init?.method === 'PATCH') {
        secondPatchBody = (JSON.parse(init.body as string) as { summary: string }).summary
        return new Response(JSON.stringify({ id: 'g1', etag: '"e3"', updated: '2026-09-23T12:00:00.000Z' }), { status: 200 })
      }
      return new Response(JSON.stringify({ items: [], nextSyncToken: 'tok2' }), { status: 200 })
    })
    await ctx.sync.syncNow('manual')

    expect(secondPatchBody).toBe('v3 (edited mid-flight)')
    expect(ctx.events.getById(ev.id)).toMatchObject({ dirty: false, etag: '"e3"' })
  })

  it('deleting an event while its first insert is in flight still deletes it from Google, not just locally', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const ev = ctx.events.create({ title: 'new event', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })

    let deletedId: string | undefined
    ctx.http.on(/\/events$/, (_url, init) => {
      if (init?.method !== 'POST') throw new Error('unexpected ' + init?.method)
      // The user deletes the event before Google's "created" response comes back.
      ctx.events.softDelete(ev.id)
      return new Response(JSON.stringify({ id: googleIdFor(ev.id), etag: '"e1"', updated: '2026-09-23T11:00:00.000Z' }), {
        status: 200
      })
    })
    ctx.http.on(new RegExp(`events/${googleIdFor(ev.id)}$`), (_url, init) => {
      if (init?.method === 'DELETE') {
        deletedId = googleIdFor(ev.id)
        return new Response(null, { status: 204 })
      }
      throw new Error('unexpected ' + init?.method)
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual') // insert completes but the delete raced it — row stays dirty
    expect(ctx.events.getById(ev.id)).toBeUndefined() // soft-deleted, hidden from getById
    expect(deletedId).toBeUndefined() // not sent yet — the insert's markSynced correctly left it dirty

    await ctx.sync.syncNow('manual') // now the deletion itself gets pushed

    expect(deletedId).toBe(googleIdFor(ev.id))
    const raw = ctx.db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id)
    expect(raw).toBeUndefined() // purged locally once the delete is confirmed
  })

  it('an override exception edited again while its patch is in flight keeps it dirty', async () => {
    const ctx = setup()
    await connectAccount(ctx)
    const ev = ctx.events.create({
      title: 'series',
      color: '#3b82f6',
      startTs: 1000,
      endTs: 2000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    ctx.events.upsertExceptionFromRemote({
      eventId: ev.id,
      occurrenceStartTs: 1500,
      kind: 'override',
      override: { title: 'v1' },
      googleId: 'gx1',
      etag: '"e1"'
    })
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'override', override: { title: 'v2' } })

    ctx.http.on(/events\/gx1$/, (_url, init) => {
      if (init?.method === 'PATCH') {
        ctx.events.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'override', override: { title: 'v3' } })
        return new Response(JSON.stringify({ id: 'gx1', etag: '"e2"' }), { status: 200 })
      }
      throw new Error('unexpected ' + init?.method)
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(ctx.events.listDirtyExceptions()).toHaveLength(1) // v3 was never sent
    expect(ctx.events.listExceptions(ev.id)[0].override?.title).toBe('v3')
  })
})

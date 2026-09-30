// End-to-end duplicate-prevention scenarios: each drives SyncService against a stateful fake
// Google Calendar across several runs and asserts exactly one copy of every event on each side.
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
import { FakeGoogleCalendar } from '../support/fakes/FakeGoogleCalendar'

const cfg: GoogleOAuthConfig = {
  clientId: 'id',
  clientSecret: 'secret',
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
  apiBase: 'https://www.googleapis.com/calendar/v3',
  scopes: []
}

const ME = 'me@x.com'
const OTHER = 'other@x.com'

function setup() {
  const db = createTestDb()
  const clock = new FakeClock('2026-09-23T10:00:00')
  const events = new EventsRepo(db, clock)
  const calendars = new SyncCalendarsRepo(db)
  const meta = new MetaRepo(db)
  const http = new FakeHttpClient()
  const secrets = new FakeSecretStore()
  const browser = new FakeBrowserLauncher()
  const loopback = new FakeLoopbackServer()
  const auth = new GoogleAuth(cfg, http, secrets, browser, loopback, clock)
  const client = new GoogleCalendarClient(cfg, http, auth, clock)
  const google = new FakeGoogleCalendar().install(http)
  http.onJson(/\/colors$/, 200, { event: { '1': { background: '#3b82f6', foreground: '#fff' } } })
  http.onJson(/revoke/, 200, {})
  const sync = new SyncService(clock, new FakePowerEvents(), auth, client, events, calendars, meta, new SpyRendererBridge(), true)
  return { db, clock, events, calendars, meta, http, browser, loopback, google, sync }
}
type Ctx = ReturnType<typeof setup>

/** Runs the real OAuth connect flow as `email`, whose primary calendar id is the email,
 *  then waits for the sync that connect() kicks off. */
async function connectAs(ctx: Ctx, email: string, extraCalendars: { id: string; summary: string }[] = []) {
  const idToken = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.s`
  ctx.http.onJson(/token/, 200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken })
  ctx.http.onJson(/calendarList/, 200, { items: [{ id: email, summary: 'Me', primary: true }, ...extraCalendars] })
  const opened = ctx.browser.opened.length
  const pending = ctx.sync.connect()
  for (let i = 0; i < 50 && ctx.browser.opened.length === opened; i++) await Promise.resolve()
  for (let i = 0; i < 5; i++) await Promise.resolve() // let connect() reach waitForCallback
  const state = new URL(ctx.browser.opened[opened]).searchParams.get('state')!
  ctx.loopback.deliver({ code: 'c', state })
  const status = await pending
  expect(status.connected).toBe(true)
  await ctx.sync.syncNow('timer') // joins the run connect() started
}

function localCount(ctx: Ctx): number {
  return (ctx.db.prepare('SELECT COUNT(*) AS c FROM events WHERE deleted_at IS NULL').get() as { c: number }).c
}

function inserts(ctx: Ctx): number {
  return ctx.http.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/events')).length
}

function newEvent(ctx: Ctx, title = 'mine') {
  return ctx.events.create({ title, color: '#3b82f6', startTs: 1_000_000, endTs: 2_000_000, allDay: false })
}

describe('Google sync never duplicates events', () => {
  it('inserts under an id derived from the local id', async () => {
    const ctx = setup()
    await connectAs(ctx, ME)
    const ev = newEvent(ctx)

    await ctx.sync.syncNow('manual')

    expect(ctx.google.live(ME).map((e) => e.id)).toEqual([googleIdFor(ev.id)])
    expect(ctx.events.getById(ev.id)).toMatchObject({ googleId: googleIdFor(ev.id), dirty: false })
  })

  it('an insert whose response was lost, with nothing pulled in between, is not inserted again', async () => {
    const ctx = setup()
    await connectAs(ctx, ME)
    const ev = newEvent(ctx)
    ctx.google.loseNextResponse = (m) => m === 'POST'
    ctx.google.breakLists = true

    await ctx.sync.syncNow('manual')
    expect(ctx.events.getById(ev.id)?.googleId).toBeUndefined() // we never heard back
    ctx.google.breakLists = false
    ctx.events.update(ev.id, { title: 'edited meanwhile' })
    await ctx.sync.syncNow('manual')
    await ctx.sync.syncNow('manual')

    expect(ctx.google.live(ME)).toHaveLength(1)
    expect(ctx.google.live(ME)[0].summary).toBe('edited meanwhile')
    expect(localCount(ctx)).toBe(1)
    expect(ctx.events.getById(ev.id)).toMatchObject({ googleId: googleIdFor(ev.id), dirty: false })
  })

  it('an insert whose response was lost, then pulled back in the same run, is adopted once', async () => {
    const ctx = setup()
    await connectAs(ctx, ME)
    const ev = newEvent(ctx)
    ctx.google.loseNextResponse = (m) => m === 'POST'

    await ctx.sync.syncNow('manual')
    await ctx.sync.syncNow('manual')

    expect(ctx.google.live(ME)).toHaveLength(1)
    expect(localCount(ctx)).toBe(1)
    expect(ctx.events.getById(ev.id)?.dirty).toBe(false)
  })

  it('deleting an event whose insert went unconfirmed removes the Google copy too (no resurrection)', async () => {
    const ctx = setup()
    await connectAs(ctx, ME)
    const ev = newEvent(ctx)
    ctx.google.loseNextResponse = (m) => m === 'POST'
    ctx.google.breakLists = true
    await ctx.sync.syncNow('manual')
    ctx.google.breakLists = false

    ctx.events.softDelete(ev.id)
    await ctx.sync.syncNow('manual')
    await ctx.sync.syncNow('manual')

    expect(ctx.google.live(ME)).toHaveLength(0)
    expect(localCount(ctx)).toBe(0)
  })

  it('a retried insert stays in its original calendar even if the default target changed meanwhile', async () => {
    const ctx = setup()
    await connectAs(ctx, ME, [{ id: 'work', summary: 'Work' }])
    ctx.calendars.setEnabled('work', true)
    const ev = newEvent(ctx)
    ctx.google.loseNextResponse = (m) => m === 'POST'
    ctx.google.breakLists = true
    await ctx.sync.syncNow('manual')
    ctx.google.breakLists = false

    await ctx.sync.setDefaultTarget('work')
    await ctx.sync.syncNow('manual')
    await ctx.sync.syncNow('manual')

    expect(ctx.google.live(ME)).toHaveLength(1)
    expect(ctx.google.live('work')).toHaveLength(0)
    expect(localCount(ctx)).toBe(1)
    expect(ctx.events.getById(ev.id)).toMatchObject({ calendarId: ME, dirty: false })
  })

  it('when the derived id is taken by a copy deleted on Google, inserts once under the next id', async () => {
    const ctx = setup()
    await connectAs(ctx, ME)
    const ev = newEvent(ctx)
    ctx.google.seed(ME, {
      id: googleIdFor(ev.id),
      status: 'cancelled',
      summary: 'mine',
      start: {},
      end: {},
      extendedProperties: { private: { hengamId: ev.id } }
    })

    await ctx.sync.syncNow('manual')
    await ctx.sync.syncNow('manual')

    expect(ctx.google.live(ME).map((e) => e.id)).toEqual([googleIdFor(ev.id, 1)])
    expect(localCount(ctx)).toBe(1)
    expect(ctx.events.getById(ev.id)?.googleId).toBe(googleIdFor(ev.id, 1))
  })

  it('disconnect then reconnect to the same account re-links events instead of re-inserting them', async () => {
    const ctx = setup()
    ctx.google.seed(ME, { id: 'made-on-google', summary: 'from Google', start: { dateTime: '2026-09-24T09:00:00Z' }, end: { dateTime: '2026-09-24T10:00:00Z' } })
    await connectAs(ctx, ME)
    const ev = newEvent(ctx)
    await ctx.sync.syncNow('manual')
    expect(localCount(ctx)).toBe(2)

    await ctx.sync.disconnect()
    ctx.clock.advance(60_000)
    ctx.events.update(ev.id, { title: 'edited while disconnected' })
    const insertsBefore = inserts(ctx)
    await connectAs(ctx, ME)
    await ctx.sync.syncNow('manual')

    expect(inserts(ctx)).toBe(insertsBefore)
    expect(ctx.google.live(ME)).toHaveLength(2)
    expect(localCount(ctx)).toBe(2)
    expect(ctx.google.live(ME).find((e) => e.id === googleIdFor(ev.id))?.summary).toBe('edited while disconnected')
  })

  it('switching to another account and back never duplicates on either account', async () => {
    const ctx = setup()
    ctx.google.seed(ME, { id: 'made-on-google', summary: 'from Google', start: { dateTime: '2026-09-24T09:00:00Z' }, end: { dateTime: '2026-09-24T10:00:00Z' } })
    await connectAs(ctx, ME)
    newEvent(ctx)
    await ctx.sync.syncNow('manual')

    await ctx.sync.disconnect()
    await connectAs(ctx, OTHER)
    await ctx.sync.syncNow('manual')
    expect(ctx.google.live(OTHER)).toHaveLength(2) // everything local is copied to the new account once
    expect(localCount(ctx)).toBe(2)

    await ctx.sync.disconnect()
    await connectAs(ctx, ME)
    await ctx.sync.syncNow('manual')

    expect(ctx.google.live(ME)).toHaveLength(2)
    expect(ctx.google.live(OTHER)).toHaveLength(2)
    expect(localCount(ctx)).toBe(2)
  })

  it('an account change without a disconnect (e.g. after the sign-in expired) also re-links correctly', async () => {
    const ctx = setup()
    await connectAs(ctx, ME)
    newEvent(ctx)
    await ctx.sync.syncNow('manual')

    await connectAs(ctx, OTHER)
    await ctx.sync.syncNow('manual')
    await connectAs(ctx, ME)
    await ctx.sync.syncNow('manual')

    expect(ctx.google.live(ME)).toHaveLength(1)
    expect(ctx.google.live(OTHER)).toHaveLength(1)
    expect(localCount(ctx)).toBe(1)
  })

  it('an event moved to another calendar on Google stays one local event', async () => {
    const ctx = setup()
    await connectAs(ctx, ME, [{ id: 'work', summary: 'Work' }])
    const ev = newEvent(ctx)
    await ctx.sync.syncNow('manual')

    // Only the destination is pulled now, so nothing would ever clean up a stale copy.
    ctx.calendars.setEnabled(ME, false)
    ctx.calendars.setEnabled('work', true)
    ctx.google.move(ME, 'work', googleIdFor(ev.id))
    await ctx.sync.syncNow('manual')

    expect(localCount(ctx)).toBe(1)
    expect(ctx.events.getById(ev.id)?.calendarId).toBe('work')
  })

  it('a sync triggered while connect() is in progress does nothing', async () => {
    const ctx = setup()
    const ev = newEvent(ctx)
    const idToken = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ email: ME })).toString('base64url')}.s`
    ctx.http.onJson(/token/, 200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken })
    ctx.http.onJson(/calendarList/, 200, { items: [{ id: ME, summary: 'Me', primary: true }] })
    const pending = ctx.sync.connect()

    const during = await ctx.sync.syncNow('timer')

    expect(during.phase).toBe('connecting')
    expect(inserts(ctx)).toBe(0)
    ctx.sync.cancelConnect()
    await pending
    expect(ctx.events.getById(ev.id)?.dirty).toBe(true)
  })
})

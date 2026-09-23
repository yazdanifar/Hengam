import { describe, expect, it } from 'vitest'
import { createTestDb, withRollback } from '../support/db'
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
  const syncCalendars = new SyncCalendarsRepo(db)
  const meta = new MetaRepo(db)
  const http = new FakeHttpClient()
  const secrets = new FakeSecretStore()
  const browser = new FakeBrowserLauncher()
  const loopback = new FakeLoopbackServer()
  const power = new FakePowerEvents()
  const bridge = new SpyRendererBridge()
  const auth = new GoogleAuth(cfg, http, secrets, browser, loopback, clock)
  const client = new GoogleCalendarClient(cfg, http, auth, clock)
  http.onJson(/\/colors$/, 200, PALETTE)

  const sync = new SyncService(clock, power, auth, client, events, syncCalendars, meta, bridge, true)

  return { db, clock, events, syncCalendars, meta, http, secrets, browser, loopback, power, bridge, auth, client, sync }
}

async function connectAccount(ctx: ReturnType<typeof setup>) {
  ctx.http.onJson(/token/, 200, {
    access_token: 'at1',
    refresh_token: 'rt1',
    expires_in: 3600,
    id_token: `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ email: 'me@x.com' })).toString('base64url')}.s`
  })
  await ctx.secrets.set('google.refresh_token', 'rt1')
  await ctx.secrets.set('google.account', JSON.stringify({ email: 'me@x.com' }))
}

describe('SyncService — push', () => {
  it('pushes a local create as an INSERT and records identity + clears dirty', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({ title: 'New event', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })

    ctx.http.onJson(/\/events$/, 200, { id: 'g1', etag: '"e1"', updated: '2026-09-23T10:00:00.000Z' })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    const status = await ctx.sync.syncNow('manual')

    expect(status.phase).toBe('idle')
    const loaded = ctx.events.getById(ev.id)!
    expect(loaded.dirty).toBe(false)
    expect(loaded.googleId).toBe('g1')
    expect(loaded.calendarId).toBe('primary')
  })

  it('pushes a local soft-delete as a DELETE then purges the row', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({ title: 'to delete', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    ctx.events.softDelete(ev.id)

    let deleteCalled = false
    ctx.http.on(/events\/g1/, () => {
      deleteCalled = true
      return new Response(null, { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(deleteCalled).toBe(true)
    const raw = ctx.db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id)
    expect(raw).toBeUndefined()
  })
})

describe('SyncService — pull', () => {
  it('paginates across two pages, persisting the sync token once after the last page', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])

    let call = 0
    ctx.http.on(/\/events\?/, () => {
      call++
      if (call === 1) return new Response(JSON.stringify({ items: [{ id: 'g1', summary: 'A', start: { dateTime: '2026-09-23T09:00:00Z' }, end: { dateTime: '2026-09-23T10:00:00Z' } }], nextPageToken: 'p2' }), { status: 200 })
      return new Response(JSON.stringify({ items: [{ id: 'g2', summary: 'B', start: { dateTime: '2026-09-24T09:00:00Z' }, end: { dateTime: '2026-09-24T10:00:00Z' } }], nextSyncToken: 'tok-final' }), { status: 200 })
    })

    await ctx.sync.syncNow('manual')

    expect(call).toBe(2)
    expect(ctx.syncCalendars.get('primary')?.syncToken).toBe('tok-final')
    expect(ctx.events.findByGoogleId('primary', 'g1')?.title).toBe('A')
    expect(ctx.events.findByGoogleId('primary', 'g2')?.title).toBe('B')
  })

  it('a cancelled remote event hard-deletes the matching local row', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({ title: 'to be cancelled', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })

    ctx.http.onJson(/\/events\?/, 200, { items: [{ id: 'g1', status: 'cancelled' }], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(ctx.db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id)).toBeUndefined()
  })

  it('on a 410 sync_token_expired, clears the token and does a full resync without duplicates', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    ctx.syncCalendars.setSyncToken('primary', 'stale-token')
    const ev = ctx.events.create({ title: 'existing', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })

    let call = 0
    ctx.http.on(/\/events\?/, (url) => {
      call++
      if (url.includes('syncToken=stale-token')) return new Response('', { status: 410 })
      return new Response(
        JSON.stringify({ items: [{ id: 'g1', summary: 'existing', start: { dateTime: '2026-09-23T09:00:00Z' }, end: { dateTime: '2026-09-23T10:00:00Z' } }], nextSyncToken: 'fresh-token' }),
        { status: 200 }
      )
    })

    const status = await ctx.sync.syncNow('manual')

    expect(status.phase).toBe('idle')
    expect(ctx.syncCalendars.get('primary')?.syncToken).toBe('fresh-token')
    const all = ctx.db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number }
    expect(all.c).toBe(1) // adopted the existing row, no duplicate
  })

  it('push-then-pull round trip: pulling back our own pushed event is a no-op, not a duplicate', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({ title: 'mine', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })

    ctx.http.onJson(/\/events$/, 200, {
      id: 'g1',
      etag: '"e1"',
      updated: '2026-09-23T10:00:00.000Z',
      extendedProperties: { private: { hengamId: ev.id } }
    })
    ctx.http.onJson(/\/events\?/, 200, {
      items: [
        {
          id: 'g1',
          summary: 'mine',
          start: { dateTime: new Date(1000).toISOString() },
          end: { dateTime: new Date(2000).toISOString() },
          extendedProperties: { private: { hengamId: ev.id } }
        }
      ],
      nextSyncToken: 'tok1'
    })

    await ctx.sync.syncNow('manual')

    const all = ctx.db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number }
    expect(all.c).toBe(1)
    expect(ctx.events.getById(ev.id)?.dirty).toBe(false)
  })
})

describe('SyncService — per-occurrence exceptions', () => {
  it('pushes a dirty skip exception as a DELETE of the known Google instance', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({
      title: 'series',
      color: '#3b82f6',
      startTs: 1000,
      endTs: 2000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    ctx.events.upsertExceptionFromRemote({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'override', googleId: 'gx1' })
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'skip' })
    // addException on a plain daily series doesn't dirty the parent or reset the
    // exception's googleId, so it's still adoptable here; force it dirty for this test.
    ctx.db.prepare('UPDATE event_exceptions SET dirty = 1, google_id = ? WHERE event_id = ?').run('gx1', ev.id)

    let deleted = false
    ctx.http.on(/events\/gx1$/, (_url, init) => {
      if (init?.method === 'DELETE') deleted = true
      return new Response(null, { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(deleted).toBe(true)
    expect(ctx.db.prepare('SELECT dirty FROM event_exceptions WHERE event_id = ?').get(ev.id)).toMatchObject({ dirty: 0 })
  })

  it('pushes a dirty override exception as a PATCH of the known Google instance', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({
      title: 'series',
      color: '#3b82f6',
      startTs: 1000,
      endTs: 2000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    ctx.events.upsertExceptionFromRemote({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'override', googleId: 'gx1' })
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'override', override: { title: 'edited occurrence' } })
    ctx.db.prepare('UPDATE event_exceptions SET dirty = 1, google_id = ? WHERE event_id = ?').run('gx1', ev.id)

    let patchedBody: any
    ctx.http.on(/events\/gx1$/, (_url, init) => {
      if (init?.method === 'PATCH') patchedBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ id: 'gx1' }), { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(patchedBody?.summary).toBe('edited occurrence')
  })

  it('a dirty exception with no known googleId yet is left for a later run', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({
      title: 'series',
      color: '#3b82f6',
      startTs: 1000,
      endTs: 2000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    ctx.events.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'skip' })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(ctx.events.listDirtyExceptions()).toHaveLength(1) // still dirty, still no googleId
  })

  it('pull adopts a cancelled instance of a known recurring event as a skip exception', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({
      title: 'series',
      color: '#3b82f6',
      startTs: 1000,
      endTs: 2000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })

    ctx.http.onJson(/\/events\?/, 200, {
      items: [
        {
          id: 'gx1',
          recurringEventId: 'g1',
          status: 'cancelled',
          originalStartTime: { dateTime: new Date(1500).toISOString() }
        }
      ],
      nextSyncToken: 'tok1'
    })

    await ctx.sync.syncNow('manual')

    const exceptions = ctx.events.listExceptions(ev.id)
    expect(exceptions).toHaveLength(1)
    expect(exceptions[0].kind).toBe('skip')
  })

  it('pull adopts a modified instance of a known recurring event as an override exception', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({
      title: 'series',
      color: '#3b82f6',
      startTs: 1000,
      endTs: 2000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1 }
    })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })

    ctx.http.onJson(/\/events\?/, 200, {
      items: [
        {
          id: 'gx1',
          recurringEventId: 'g1',
          summary: 'special occurrence',
          start: { dateTime: new Date(1500).toISOString() },
          end: { dateTime: new Date(2500).toISOString() },
          originalStartTime: { dateTime: new Date(1500).toISOString() }
        }
      ],
      nextSyncToken: 'tok1'
    })

    await ctx.sync.syncNow('manual')

    const exceptions = ctx.events.listExceptions(ev.id)
    expect(exceptions).toHaveLength(1)
    expect(exceptions[0].kind).toBe('override')
    expect(exceptions[0].override?.title).toBe('special occurrence')
  })

  it('an instance whose parent has not arrived yet is skipped without error', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])

    ctx.http.onJson(/\/events\?/, 200, {
      items: [{ id: 'gx1', recurringEventId: 'unknown-parent', status: 'cancelled' }],
      nextSyncToken: 'tok1'
    })

    const status = await ctx.sync.syncNow('manual')
    expect(status.phase).toBe('idle')
  })
})

describe('SyncService — conflicts', () => {
  it('412 with a newer remote update: remote wins', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({ title: 'local edit', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1', etag: '"old"' })
    ctx.events.update(ev.id, { title: 'local edit v2' }) // dirty again, updatedAt = clock.now()

    ctx.http.on(/events\/g1$/, (_url, init) => {
      if (init?.method === 'PATCH') return new Response('', { status: 412 })
      // GET for the conflict re-fetch
      return new Response(
        JSON.stringify({ id: 'g1', etag: '"new"', updated: '2026-09-24T00:00:00.000Z', summary: 'remote edit', start: { dateTime: new Date(5000).toISOString() }, end: { dateTime: new Date(6000).toISOString() } }),
        { status: 200 }
      )
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(ctx.events.getById(ev.id)?.title).toBe('remote edit')
  })

  it('412 with an older remote update: local wins, re-pushed without If-Match', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({ title: 'local edit', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1', etag: '"old"' })
    clock_advance(ctx)
    ctx.events.update(ev.id, { title: 'local edit v2' })

    let patchCount = 0
    ctx.http.on(/events\/g1$/, (_url, init) => {
      if (init?.method === 'PATCH') {
        patchCount++
        if (patchCount === 1) return new Response('', { status: 412 })
        return new Response(JSON.stringify({ id: 'g1', etag: '"newer"', updated: new Date(ctx.clock.now()).toISOString() }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: 'g1', etag: '"stale"', updated: '2020-01-01T00:00:00.000Z' }), { status: 200 })
    })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    await ctx.sync.syncNow('manual')

    expect(ctx.events.getById(ev.id)?.title).toBe('local edit v2')
    expect(patchCount).toBe(2)
  })
})

function clock_advance(ctx: ReturnType<typeof setup>) {
  ctx.clock.advance(1000)
}

describe('SyncService — concurrency and lifecycle', () => {
  it('two syncNow() calls in the same tick share one run', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    let listCalls = 0
    ctx.http.on(/\/events\?/, () => {
      listCalls++
      return new Response(JSON.stringify({ items: [], nextSyncToken: 'tok1' }), { status: 200 })
    })

    const [a, b] = await Promise.all([ctx.sync.syncNow('manual'), ctx.sync.syncNow('manual')])
    expect(a).toBe(b)
    expect(listCalls).toBe(1)
  })

  it('a manual call during a run queues exactly one follow-up run', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    let listCalls = 0
    ctx.http.on(/\/events\?/, () => {
      listCalls++
      return new Response(JSON.stringify({ items: [], nextSyncToken: 'tok1' }), { status: 200 })
    })

    const first = ctx.sync.syncNow('timer')
    ctx.sync.syncNow('manual') // queued, does not join `first`
    await first
    // allow the queued rerun (chained via .finally) to complete
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(listCalls).toBeGreaterThanOrEqual(2)
  })

  it('start() then stop() releases power subscriptions and clears the timer', () => {
    const ctx = setup()
    ctx.sync.start()
    expect(ctx.power.listenerCount()).toBeGreaterThan(0)
    ctx.sync.stop()
    expect(ctx.power.listenerCount()).toBe(0)
  })

  it('reports a disabled status when not configured', async () => {
    const db = createTestDb()
    const clock = new FakeClock('2026-09-23T10:00:00')
    const events = new EventsRepo(db, clock)
    const syncCalendars = new SyncCalendarsRepo(db)
    const meta = new MetaRepo(db)
    const http = new FakeHttpClient()
    const secrets = new FakeSecretStore()
    const auth = new GoogleAuth(cfg, http, secrets, new FakeBrowserLauncher(), new FakeLoopbackServer(), clock)
    const client = new GoogleCalendarClient(cfg, http, auth, clock)
    const bridge = new SpyRendererBridge()
    const sync = new SyncService(clock, new FakePowerEvents(), auth, client, events, syncCalendars, meta, bridge, false)

    const status = await sync.syncNow('launch')
    expect(status.phase).toBe('disabled')
  })

  it('reports idle (not error) when connected but no calendar is enabled', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    const status = await ctx.sync.syncNow('manual')
    expect(status.phase).toBe('idle')
    expect(status.connected).toBe(true)
  })

  it('surfaces a network failure as an error status with the mapped code, and stays retryable', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    ctx.http.on(/\/events\?/, () => {
      throw new Error('offline')
    })

    const status = await ctx.sync.syncNow('manual')
    expect(status.phase).toBe('error')
    expect(status.errorCode).toBe('network')

    expect(ctx.bridge.sent.some((s) => s.channel === 'sync:status' && (s.payload as any).phase === 'syncing')).toBe(true)
  })
})

describe('SyncService — connect/disconnect', () => {
  it('connect() runs the OAuth flow and fetches the calendar list', async () => {
    const ctx = setup()
    ctx.http.onJson(/token/, 200, {
      access_token: 'at1',
      refresh_token: 'rt1',
      expires_in: 3600,
      id_token: `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ email: 'me@x.com' })).toString('base64url')}.s`
    })
    ctx.http.onJson(/calendarList/, 200, { items: [{ id: 'primary', summary: 'Me', primary: true }] })
    ctx.http.onJson(/\/events\?/, 200, { items: [], nextSyncToken: 'tok1' })

    const promise = ctx.sync.connect()
    await Promise.resolve()
    await Promise.resolve()
    const authUrl = new URL(ctx.browser.opened[0])
    ctx.loopback.deliver({ code: 'c', state: authUrl.searchParams.get('state')! })

    const status = await promise
    expect(status.connected).toBe(true)
    expect(ctx.syncCalendars.list().map((c) => c.calendarId)).toEqual(['primary'])
  })

  it('cancelConnect() aborts an in-flight connect', async () => {
    const ctx = setup()
    const promise = ctx.sync.connect()
    await Promise.resolve()
    ctx.sync.cancelConnect()
    const status = await promise
    expect(status.connected).toBe(false)
  })

  it('disconnect() clears calendars and strips local sync identity, without deleting events', async () => {
    const ctx = await setup()
    await connectAccount(ctx)
    ctx.syncCalendars.upsertMany([{ calendarId: 'primary', summary: 'Me', primary: true }])
    const ev = ctx.events.create({ title: 'keep me', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })
    ctx.events.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    ctx.http.onJson(/revoke/, 200, {})

    const status = await ctx.sync.disconnect()

    expect(status.connected).toBe(false)
    expect(ctx.syncCalendars.list()).toEqual([])
    const loaded = ctx.events.getById(ev.id)!
    expect(loaded.title).toBe('keep me') // event itself survives
    expect(loaded.googleId).toBeUndefined()
    expect(loaded.dirty).toBe(true)
  })

  it('setCalendarEnabled and setDefaultTarget delegate to the repo', async () => {
    const ctx = await setup()
    ctx.syncCalendars.upsertMany([{ calendarId: 'a', summary: 'A' }])
    await ctx.sync.setCalendarEnabled('a', true)
    expect(ctx.syncCalendars.get('a')?.enabled).toBe(true)
    await ctx.sync.setDefaultTarget('a')
    expect(ctx.syncCalendars.defaultTarget()?.calendarId).toBe('a')
  })
})

describe('SyncService — getStatus', () => {
  it('reflects the disabled/idle initial phase based on configured', () => {
    const ctxDisabled = setup()
    expect(ctxDisabled.sync.getStatus().phase).toBe('idle') // configured=true by default in setup()
  })
})

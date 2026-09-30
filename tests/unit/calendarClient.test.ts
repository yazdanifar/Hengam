import { describe, expect, it, vi } from 'vitest'
import { GoogleCalendarClient } from '@main/sync/GoogleCalendarClient'
import { SyncError } from '@main/sync/errors'
import type { GoogleOAuthConfig } from '@main/sync/googleConfig'
import { FakeClock } from '../support/fakes/FakeClock'
import { FakeHttpClient } from '../support/fakes/FakeHttpClient'

const cfg: GoogleOAuthConfig = {
  clientId: 'id',
  clientSecret: 'secret',
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
  apiBase: 'https://www.googleapis.com/calendar/v3',
  scopes: []
}

function fakeAuth(tokens: string[] = ['token-1']) {
  let i = 0
  return {
    getAccessToken: vi.fn(async () => tokens[Math.min(i++, tokens.length - 1)]),
    invalidateAccessToken: vi.fn()
  }
}

describe('GoogleCalendarClient', () => {
  it('sends the bearer token and returns parsed JSON on success', async () => {
    const http = new FakeHttpClient()
    http.onJson(/calendarList/, 200, { items: [{ id: 'primary', summary: 'Me' }] })
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    const cals = await client.listCalendars()
    expect(cals).toEqual([{ id: 'primary', summary: 'Me' }])
    expect(http.calls[0].headers.Authorization).toBe('Bearer token-1')
  })

  it('on 401 invalidates the token and retries exactly once', async () => {
    const http = new FakeHttpClient()
    let calls = 0
    http.on(/events\?/, () => {
      calls++
      return calls === 1 ? new Response('', { status: 401 }) : new Response(JSON.stringify({ items: [] }), { status: 200 })
    })
    const auth = fakeAuth(['expired', 'fresh'])
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    const page = await client.listEvents('primary', {})
    expect(page.items).toEqual([])
    expect(auth.invalidateAccessToken).toHaveBeenCalledTimes(1)
    expect(calls).toBe(2)
  })

  it('does not retry a second 401 in a row (avoids an infinite loop)', async () => {
    const http = new FakeHttpClient()
    http.on(/events\?/, () => new Response('', { status: 401 }))
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    await expect(client.listEvents('primary', {})).rejects.toThrow(SyncError)
  })

  it('412 on patch/delete throws SyncError(conflict)', async () => {
    const http = new FakeHttpClient()
    http.on(/events\/ev1/, () => new Response('', { status: 412 }))
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    await expect(client.patchEvent('primary', 'ev1', {}, 'etag1')).rejects.toMatchObject({ code: 'conflict' })
  })

  it('410 on a list call throws SyncError(sync_token_expired)', async () => {
    const http = new FakeHttpClient()
    http.on(/events\?/, () => new Response('', { status: 410 }))
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    await expect(client.listEvents('primary', { syncToken: 'stale' })).rejects.toMatchObject({ code: 'sync_token_expired' })
  })

  it('404 on delete is treated as success', async () => {
    const http = new FakeHttpClient()
    http.on(/events\/gone/, () => new Response('', { status: 404 }))
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    await expect(client.deleteEvent('primary', 'gone', undefined)).resolves.toBe(false)
  })

  it('410 on delete (already deleted) is treated as success, and reports the event existed', async () => {
    const http = new FakeHttpClient()
    http.on(/events\/was/, () => new Response('', { status: 410 }))
    const client = new GoogleCalendarClient(cfg, http, fakeAuth() as any, new FakeClock('2026-09-23T00:00:00'))

    await expect(client.deleteEvent('primary', 'was', undefined)).resolves.toBe(true)
  })

  it('409 on insert (id already taken) throws SyncError(conflict)', async () => {
    const http = new FakeHttpClient()
    http.on(/events$/, () => new Response('', { status: 409 }))
    const client = new GoogleCalendarClient(cfg, http, fakeAuth() as any, new FakeClock('2026-09-23T00:00:00'))

    await expect(
      client.insertEvent('primary', { id: 'abcde', summary: 'x', start: {}, end: {} })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('getEvent resolves undefined for an unknown id', async () => {
    const http = new FakeHttpClient()
    http.on(/events\/nope/, () => new Response('', { status: 404 }))
    const client = new GoogleCalendarClient(cfg, http, fakeAuth() as any, new FakeClock('2026-09-23T00:00:00'))

    await expect(client.getEvent('primary', 'nope')).resolves.toBeUndefined()
  })

  it('retries 429 with backoff driven by the fake clock, then succeeds', async () => {
    const http = new FakeHttpClient()
    let attempts = 0
    http.on(/events\/ev1$/, () => {
      attempts++
      if (attempts < 3) return new Response(JSON.stringify({ error: {} }), { status: 429 })
      return new Response(JSON.stringify({ id: 'ev1' }), { status: 200 })
    })
    const auth = fakeAuth()
    const clock = new FakeClock('2026-09-23T00:00:00')
    const client = new GoogleCalendarClient(cfg, http, auth as any, clock)

    const promise = client.getEvent('primary', 'ev1')
    // Drive the fake clock forward so the backoff sleeps (clock.setTimeout) resolve.
    for (let i = 0; i < 5 && attempts < 3; i++) {
      clock.advance(10_000)
      await Promise.resolve()
      await Promise.resolve()
    }
    const result = await promise
    expect(result).toEqual({ id: 'ev1' })
    expect(attempts).toBe(3)
  })

  it('gives up after the max retries and throws a server SyncError for a persistent 500', async () => {
    const http = new FakeHttpClient()
    http.on(/events\/ev1$/, () => new Response('', { status: 500 }))
    const auth = fakeAuth()
    const clock = new FakeClock('2026-09-23T00:00:00')
    const client = new GoogleCalendarClient(cfg, http, auth as any, clock)

    const promise = client.getEvent('primary', 'ev1')
    const assertion = expect(promise).rejects.toMatchObject({ code: 'server' })
    for (let i = 0; i < 6; i++) {
      clock.advance(20_000)
      await Promise.resolve()
      await Promise.resolve()
    }
    await assertion
  })

  it('a thrown fetch (network failure) surfaces as SyncError(network)', async () => {
    const http = new FakeHttpClient()
    http.on(/events\/ev1$/, () => {
      throw new Error('offline')
    })
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    await expect(client.getEvent('primary', 'ev1')).rejects.toMatchObject({ code: 'network' })
  })

  it('insertEvent posts a JSON body and returns the created resource', async () => {
    const http = new FakeHttpClient()
    http.onJson(/\/events$/, 200, { id: 'new1', etag: '"e1"' })
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    const created = await client.insertEvent('primary', { summary: 'Hi', start: {}, end: {} })
    expect(created).toEqual({ id: 'new1', etag: '"e1"' })
    expect(http.calls[0].method).toBe('POST')
    expect(JSON.parse(http.calls[0].body!)).toEqual({ summary: 'Hi', start: {}, end: {} })
  })

  it('patchEvent sends If-Match when an etag is provided', async () => {
    const http = new FakeHttpClient()
    http.onJson(/events\/ev1/, 200, { id: 'ev1' })
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    await client.patchEvent('primary', 'ev1', { summary: 'x' }, '"etag1"')
    expect(http.calls[0].headers['If-Match']).toBe('"etag1"')
  })

  it('listColors returns the event palette', async () => {
    const http = new FakeHttpClient()
    http.onJson(/\/colors$/, 200, { event: { '1': { background: '#fff', foreground: '#000' } }, calendar: {} })
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    expect(await client.listColors()).toEqual({ '1': { background: '#fff', foreground: '#000' } })
  })

  it('getInstance requests the parent event\'s instances filtered by originalStart', async () => {
    const http = new FakeHttpClient()
    let seenUrl: string | undefined
    http.on(/events\/g1\/instances/, (url) => {
      seenUrl = url
      return new Response(JSON.stringify({ items: [{ id: 'gi1', etag: '"e1"' }] }), { status: 200 })
    })
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    const instance = await client.getInstance('primary', 'g1', '2026-01-01T09:00:00.000Z')
    expect(instance).toEqual({ id: 'gi1', etag: '"e1"' })
    expect(seenUrl).toContain('/events/g1/instances?')
    expect(seenUrl).toContain(`originalStart=${encodeURIComponent('2026-01-01T09:00:00.000Z')}`)
  })

  it('getInstance returns undefined when there is no matching instance', async () => {
    const http = new FakeHttpClient()
    http.onJson(/instances/, 200, { items: [] })
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    expect(await client.getInstance('primary', 'g1', '2026-01-01T09:00:00.000Z')).toBeUndefined()
  })

  it('getInstance returns undefined when the parent itself is gone (404)', async () => {
    const http = new FakeHttpClient()
    http.on(/instances/, () => new Response('', { status: 404 }))
    const auth = fakeAuth()
    const client = new GoogleCalendarClient(cfg, http, auth as any, new FakeClock('2026-09-23T00:00:00'))

    expect(await client.getInstance('primary', 'g1', '2026-01-01T09:00:00.000Z')).toBeUndefined()
  })
})

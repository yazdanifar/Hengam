import { describe, expect, it } from 'vitest'
import { GoogleAuth } from '@main/sync/GoogleAuth'
import { GoogleAuthError } from '@main/sync/errors'
import type { GoogleOAuthConfig } from '@main/sync/googleConfig'
import { FakeClock } from '../support/fakes/FakeClock'
import { FakeHttpClient } from '../support/fakes/FakeHttpClient'
import { FakeSecretStore } from '../support/fakes/FakeSecretStore'
import { FakeLoopbackServer } from '../support/fakes/FakeLoopbackServer'
import { FakeBrowserLauncher } from '../support/fakes/FakeBrowserLauncher'

const cfg: GoogleOAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
  apiBase: 'https://www.googleapis.com/calendar/v3',
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar']
}

function idToken(email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ email })).toString('base64url')
  return `${header}.${payload}.sig`
}

function setup() {
  const clock = new FakeClock('2026-09-23T10:00:00')
  const http = new FakeHttpClient()
  const secrets = new FakeSecretStore()
  const browser = new FakeBrowserLauncher()
  const loopback = new FakeLoopbackServer()
  const auth = new GoogleAuth(cfg, http, secrets, browser, loopback, clock)
  return { clock, http, secrets, browser, loopback, auth }
}

describe('GoogleAuth.connect', () => {
  it('opens an auth URL with S256 PKCE and the loopback redirect_uri, then exchanges the code', async () => {
    const { http, browser, loopback, auth } = setup()
    http.onJson(/oauth2\.googleapis\.com\/token/, 200, {
      access_token: 'at1',
      refresh_token: 'rt1',
      expires_in: 3600,
      scope: 'openid email',
      id_token: idToken('me@example.com')
    })

    const promise = auth.connect(new AbortController().signal)
    await Promise.resolve() // let connect() reach waitForCallback
    await Promise.resolve()
    const authUrl = new URL(browser.opened[0])
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9999/callback')
    const state = authUrl.searchParams.get('state')!

    loopback.deliver({ code: 'auth-code', state })
    const result = await promise

    expect(result).toEqual({ connected: true, email: 'me@example.com' })
    expect(await auth.isConnected()).toBe(true)
    expect(await auth.getEmail()).toBe('me@example.com')
  })

  it('rejects on state mismatch before any token request is made', async () => {
    const { http, loopback, auth } = setup()
    const promise = auth.connect(new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()

    loopback.deliver({ code: 'auth-code', state: 'wrong-state' })

    await expect(promise).rejects.toThrow(GoogleAuthError)
    await expect(promise).rejects.toMatchObject({ code: 'state_mismatch' })
    expect(http.calls).toHaveLength(0)
  })

  it('maps an error param from Google to a denied GoogleAuthError', async () => {
    const { loopback, auth } = setup()
    const promise = auth.connect(new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()

    loopback.deliver({ error: 'access_denied' })

    await expect(promise).rejects.toMatchObject({ code: 'denied' })
  })

  it('closes the loopback server even when the flow throws', async () => {
    const { loopback, auth } = setup()
    const promise = auth.connect(new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()
    loopback.deliver({ error: 'access_denied' })
    await promise.catch(() => {})
    expect(loopback.closeCount).toBe(1)
  })

  it('aborting the signal while waiting closes the loopback and rejects with cancelled', async () => {
    const { loopback, auth } = setup()
    const controller = new AbortController()
    const promise = auth.connect(controller.signal)
    await Promise.resolve()
    await Promise.resolve()

    controller.abort()

    await expect(promise).rejects.toMatchObject({ code: 'cancelled' })
    expect(loopback.closeCount).toBe(1)
  })

  it('surfaces a token-exchange failure as token_exchange_failed', async () => {
    const { http, browser, loopback, auth } = setup()
    http.onJson(/token/, 400, { error: 'invalid_grant', error_description: 'bad code' })
    const promise = auth.connect(new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()
    const authUrl = new URL(browser.opened[0])
    loopback.deliver({ code: 'bad-code', state: authUrl.searchParams.get('state')! })

    await expect(promise).rejects.toMatchObject({ code: 'token_exchange_failed' })
  })

  it('rejects with token_exchange_failed when Google omits a refresh_token', async () => {
    const { http, browser, loopback, auth } = setup()
    http.onJson(/token/, 200, { access_token: 'at1', expires_in: 3600 })
    const promise = auth.connect(new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()
    const authUrl = new URL(browser.opened[0])
    loopback.deliver({ code: 'c', state: authUrl.searchParams.get('state')! })

    await expect(promise).rejects.toMatchObject({ code: 'token_exchange_failed' })
  })
})

describe('GoogleAuth.getAccessToken', () => {
  async function connected() {
    const ctx = setup()
    ctx.http.onJson(/token/, 200, {
      access_token: 'at1',
      refresh_token: 'rt1',
      expires_in: 3600,
      id_token: idToken('me@example.com')
    })
    const promise = ctx.auth.connect(new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()
    const authUrl = new URL(ctx.browser.opened[0])
    ctx.loopback.deliver({ code: 'c', state: authUrl.searchParams.get('state')! })
    await promise
    ctx.http.calls = []
    return ctx
  }

  it('returns the cached token when well within its expiry margin', async () => {
    const { auth, http } = await connected()
    const token = await auth.getAccessToken()
    expect(token).toBe('at1')
    expect(http.calls).toHaveLength(0)
  })

  it('refreshes once for N concurrent callers when the token is near/at expiry (single-flight)', async () => {
    const { auth, http, clock } = await connected()
    clock.advance(3600_000) // token now expired
    http.onJson(/token/, 200, { access_token: 'at2', expires_in: 3600 })

    const [a, b, c] = await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()])
    expect([a, b, c]).toEqual(['at2', 'at2', 'at2'])
    expect(http.calls).toHaveLength(1)
  })

  it('invalidateAccessToken() forces the next call to refresh', async () => {
    const { auth, http } = await connected()
    auth.invalidateAccessToken()
    http.onJson(/token/, 200, { access_token: 'at2', expires_in: 3600 })
    const token = await auth.getAccessToken()
    expect(token).toBe('at2')
    expect(http.calls).toHaveLength(1)
  })

  it('throws not_connected when there is no stored refresh token', async () => {
    const { auth } = setup()
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'not_connected' })
  })

  it('an invalid_grant refresh response clears secrets and throws reauth_required', async () => {
    const { auth, http, clock, secrets } = await connected()
    clock.advance(3600_000)
    http.onJson(/token/, 400, { error: 'invalid_grant' })

    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'reauth_required' })
    expect(await secrets.get('google.refresh_token')).toBeUndefined()
    expect(await auth.isConnected()).toBe(false)
  })

  it('a network failure on refresh throws network and does not clear credentials', async () => {
    const { auth, http, clock } = await connected()
    clock.advance(3600_000)
    http.on(/token/, () => {
      throw new Error('offline')
    })

    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'network' })
    expect(await auth.isConnected()).toBe(true)
  })

  it('rotates the stored refresh token when the response includes a new one', async () => {
    const { auth, http, clock, secrets } = await connected()
    clock.advance(3600_000)
    http.onJson(/token/, 200, { access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 })
    await auth.getAccessToken()
    expect(await secrets.get('google.refresh_token')).toBe('rt2')
  })
})

describe('GoogleAuth.disconnect', () => {
  it('revokes best-effort, clears secrets, and isConnected() becomes false', async () => {
    const ctx = setup()
    ctx.http.onJson(/token/, 200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 })
    const promise = ctx.auth.connect(new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()
    const authUrl = new URL(ctx.browser.opened[0])
    ctx.loopback.deliver({ code: 'c', state: authUrl.searchParams.get('state')! })
    await promise

    ctx.http.onJson(/revoke/, 200, {})
    await ctx.auth.disconnect()
    expect(await ctx.auth.isConnected()).toBe(false)
  })

  it('disconnect() succeeds even when revoke is offline', async () => {
    const ctx = setup()
    ctx.http.onJson(/token/, 200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 })
    const promise = ctx.auth.connect(new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()
    const authUrl = new URL(ctx.browser.opened[0])
    ctx.loopback.deliver({ code: 'c', state: authUrl.searchParams.get('state')! })
    await promise

    ctx.http.on(/revoke/, () => {
      throw new Error('offline')
    })
    await expect(ctx.auth.disconnect()).resolves.toBeUndefined()
    expect(await ctx.auth.isConnected()).toBe(false)
  })

  it('disconnect() when never connected is a no-op that does not throw', async () => {
    const { auth } = setup()
    await expect(auth.disconnect()).resolves.toBeUndefined()
  })
})

// Orchestrates the OAuth 2.0 Authorization Code + PKCE flow (RFC 7636) against Google's
// endpoints, using only ports — no `electron` import, fully fakeable in tests.
import type { BrowserLauncher, Clock, HttpClient, LoopbackServerPort, SecretStore } from '../ports'
import { challengeFromVerifier, createState, createVerifier } from './pkce'
import type { GoogleOAuthConfig } from './googleConfig'
import { GoogleAuthError } from './errors'

const EXPIRY_MARGIN_MS = 120_000
const CONNECT_TIMEOUT_MS = 5 * 60_000
const REFRESH_TOKEN_KEY = 'google.refresh_token'
const ACCOUNT_KEY = 'google.account'

export interface AuthState {
  connected: boolean
  email?: string
}

interface StoredAccount {
  email?: string
  scope?: string
  connectedAt: number
}

interface AccessToken {
  token: string
  expiresAt: number
}

/** Links several AbortSignals into one that aborts when any of them does, with cleanup. */
function linkSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  for (const s of signals) {
    if (s.aborted) controller.abort()
    else s.addEventListener('abort', onAbort, { once: true })
  }
  return controller.signal
}

function decodeEmailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined
  try {
    const payload = idToken.split('.')[1]
    const json = Buffer.from(payload, 'base64url').toString('utf-8')
    return (JSON.parse(json) as { email?: string }).email
  } catch {
    return undefined
  }
}

export class GoogleAuth {
  private accessToken: AccessToken | null = null
  private refreshInFlight: Promise<string> | null = null

  constructor(
    private cfg: GoogleOAuthConfig,
    private http: HttpClient,
    private secrets: SecretStore,
    private browser: BrowserLauncher,
    private loopback: LoopbackServerPort,
    private clock: Clock
  ) {}

  async connect(signal: AbortSignal): Promise<AuthState> {
    const redirect = await this.loopback.listen('/callback')
    try {
      const verifier = createVerifier()
      const challenge = challengeFromVerifier(verifier)
      const state = createState()

      const authUrl = `${this.cfg.authEndpoint}?${new URLSearchParams({
        client_id: this.cfg.clientId,
        redirect_uri: redirect.redirectUri,
        response_type: 'code',
        scope: this.cfg.scopes.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent'
      }).toString()}`

      await this.browser.open(authUrl)

      const timeoutSignal = AbortSignal.timeout(CONNECT_TIMEOUT_MS)
      const params = await redirect.waitForCallback(linkSignals([signal, timeoutSignal])).catch((err) => {
        throw new GoogleAuthError('cancelled', String(err))
      })

      if (params.error) throw new GoogleAuthError('denied', params.error)
      if (params.state !== state) throw new GoogleAuthError('state_mismatch')
      if (!params.code) throw new GoogleAuthError('token_exchange_failed', 'no code in callback')

      const tokenRes = await this.http.fetch(this.cfg.tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: params.code,
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          code_verifier: verifier,
          grant_type: 'authorization_code',
          redirect_uri: redirect.redirectUri
        }).toString()
      })

      const body = await tokenRes.json().catch(() => ({}))
      if (!tokenRes.ok) {
        throw new GoogleAuthError('token_exchange_failed', body?.error_description ?? body?.error ?? String(tokenRes.status))
      }

      const email = decodeEmailFromIdToken(body.id_token)
      if (!body.refresh_token) {
        // Should not happen with access_type=offline + prompt=consent, but fail cleanly.
        throw new GoogleAuthError('token_exchange_failed', 'no refresh_token in response')
      }

      console.warn('[auth] token exchange granted scope:', body.scope, '(requested:', this.cfg.scopes.join(' '), ')')
      this.accessToken = { token: body.access_token, expiresAt: this.clock.now() + (body.expires_in ?? 3600) * 1000 }
      await this.secrets.set(REFRESH_TOKEN_KEY, body.refresh_token)
      const account: StoredAccount = { email, scope: body.scope, connectedAt: this.clock.now() }
      await this.secrets.set(ACCOUNT_KEY, JSON.stringify(account))

      return { connected: true, email }
    } finally {
      redirect.close()
    }
  }

  async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - this.clock.now() > EXPIRY_MARGIN_MS) {
      return this.accessToken.token
    }
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.refresh(signal).finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  private async refresh(signal?: AbortSignal): Promise<string> {
    const refreshToken = await this.secrets.get(REFRESH_TOKEN_KEY)
    if (!refreshToken) throw new GoogleAuthError('not_connected')

    let res: Response
    try {
      res = await this.http.fetch(this.cfg.tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret
        }).toString(),
        signal
      })
    } catch (err) {
      throw new GoogleAuthError('network', String(err))
    }

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (body?.error === 'invalid_grant') {
        await this.secrets.delete(REFRESH_TOKEN_KEY)
        await this.secrets.delete(ACCOUNT_KEY)
        this.accessToken = null
        throw new GoogleAuthError('reauth_required', body?.error_description)
      }
      throw new GoogleAuthError('token_exchange_failed', body?.error_description ?? String(res.status))
    }

    if (body.refresh_token) await this.secrets.set(REFRESH_TOKEN_KEY, body.refresh_token)
    this.accessToken = { token: body.access_token, expiresAt: this.clock.now() + (body.expires_in ?? 3600) * 1000 }
    return this.accessToken.token
  }

  /** Forces the next getAccessToken() to refresh (used by GoogleCalendarClient on 401). */
  invalidateAccessToken(): void {
    this.accessToken = null
  }

  async disconnect(): Promise<void> {
    const refreshToken = await this.secrets.get(REFRESH_TOKEN_KEY)
    if (refreshToken) {
      try {
        await this.http.fetch(`${this.cfg.revokeEndpoint}?${new URLSearchParams({ token: refreshToken })}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' }
        })
      } catch {
        // best effort — an offline machine must still be able to disconnect locally
      }
    }
    await this.secrets.delete(REFRESH_TOKEN_KEY)
    await this.secrets.delete(ACCOUNT_KEY)
    this.accessToken = null
  }

  async isConnected(): Promise<boolean> {
    return (await this.secrets.get(REFRESH_TOKEN_KEY)) !== undefined
  }

  async getEmail(): Promise<string | undefined> {
    const raw = await this.secrets.get(ACCOUNT_KEY)
    if (!raw) return undefined
    try {
      return (JSON.parse(raw) as StoredAccount).email
    } catch {
      return undefined
    }
  }
}

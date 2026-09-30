// Thin, hand-rolled REST wrapper over the HttpClient port. Deliberately not `googleapis`:
// that package brings its own transport and token cache (bypassing HttpClient, so it can't
// be faked without heavy mocking) for ~8 endpoints we actually need.
import type { Clock, HttpClient } from '../ports'
import type { GoogleOAuthConfig } from './googleConfig'
import type { GoogleAuth } from './GoogleAuth'
import { SyncError } from './errors'
import type { GoogleEventLike } from './mapper'

export interface GoogleCalendarListEntry {
  id: string
  summary: string
  backgroundColor?: string
  primary?: boolean
}

export interface GoogleEventResource extends GoogleEventLike {
  id: string
  etag?: string
  status?: 'confirmed' | 'cancelled' | 'tentative'
  updated?: string
  recurringEventId?: string
  originalStartTime?: { date?: string; dateTime?: string }
}

export interface ListEventsParams {
  syncToken?: string
  timeMin?: string
  pageToken?: string
  maxResults?: number
}

export interface EventsListPage {
  items: GoogleEventResource[]
  nextPageToken?: string
  nextSyncToken?: string
}

const MAX_RETRIES = 3

function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms))
}

export class GoogleCalendarClient {
  constructor(
    private cfg: GoogleOAuthConfig,
    private http: HttpClient,
    private auth: GoogleAuth,
    private clock: Clock
  ) {}

  async listCalendars(signal?: AbortSignal): Promise<GoogleCalendarListEntry[]> {
    const page = await this.request<{ items: GoogleCalendarListEntry[] }>(
      'GET',
      `${this.cfg.apiBase}/users/me/calendarList`,
      { signal }
    )
    return page.items
  }

  async listEvents(calendarId: string, params: ListEventsParams, signal?: AbortSignal): Promise<EventsListPage> {
    const qs = new URLSearchParams({ showDeleted: 'true', singleEvents: 'false' })
    qs.set('maxResults', String(params.maxResults ?? 250))
    if (params.syncToken) qs.set('syncToken', params.syncToken)
    if (params.timeMin) qs.set('timeMin', params.timeMin)
    if (params.pageToken) qs.set('pageToken', params.pageToken)
    return this.request<EventsListPage>(
      'GET',
      `${this.cfg.apiBase}/calendars/${encodeURIComponent(calendarId)}/events?${qs}`,
      { signal },
      { listCall: true }
    )
  }

  /** Undefined when Google has no such event at all. A deleted one still comes back, with
   *  status 'cancelled'. */
  async getEvent(calendarId: string, eventId: string, signal?: AbortSignal): Promise<GoogleEventResource | undefined> {
    return this.request<GoogleEventResource | undefined>(
      'GET',
      `${this.cfg.apiBase}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { signal },
      { allow404: true }
    )
  }

  /** Looks up one occurrence of a recurring event by its original start (see
   *  mapper.originalStartFor), so a local edit to that occurrence can be pushed as a
   *  PATCH/DELETE of Google's own instance id instead of waiting for a pull to reveal it.
   *  Undefined when the parent is gone or has no instance at that start. */
  async getInstance(
    calendarId: string,
    recurringEventId: string,
    originalStart: string,
    signal?: AbortSignal
  ): Promise<GoogleEventResource | undefined> {
    const qs = new URLSearchParams({ originalStart, showDeleted: 'true', maxResults: '1' })
    const page = await this.request<{ items: GoogleEventResource[] } | undefined>(
      'GET',
      `${this.cfg.apiBase}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(recurringEventId)}/instances?${qs}`,
      { signal },
      { allow404: true }
    )
    return page?.items?.[0]
  }

  /** A body carrying a client-chosen `id` that's already taken (even by a deleted event)
   *  fails with SyncError('conflict'). */
  async insertEvent(calendarId: string, body: GoogleEventLike, signal?: AbortSignal): Promise<GoogleEventResource> {
    return this.request<GoogleEventResource>(
      'POST',
      `${this.cfg.apiBase}/calendars/${encodeURIComponent(calendarId)}/events`,
      { signal, body }
    )
  }

  async patchEvent(
    calendarId: string,
    eventId: string,
    body: Partial<GoogleEventLike> & { status?: GoogleEventResource['status'] },
    etag: string | undefined,
    signal?: AbortSignal
  ): Promise<GoogleEventResource> {
    return this.request<GoogleEventResource>(
      'PATCH',
      `${this.cfg.apiBase}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { signal, body, etag }
    )
  }

  /** Already-gone (404, or 410 for an event deleted earlier) counts as success. Resolves
   *  false only when Google has never had an event with this id. */
  async deleteEvent(calendarId: string, eventId: string, etag: string | undefined, signal?: AbortSignal): Promise<boolean> {
    const res = await this.request<'missing' | undefined>(
      'DELETE',
      `${this.cfg.apiBase}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { signal, etag },
      { allow404: true, allowGone: true }
    )
    return res !== 'missing'
  }

  async listColors(signal?: AbortSignal): Promise<Record<string, { background: string; foreground: string }>> {
    const res = await this.request<{ event: Record<string, { background: string; foreground: string }> }>(
      'GET',
      `${this.cfg.apiBase}/colors`,
      { signal }
    )
    return res.event
  }

  private async request<T>(
    method: string,
    url: string,
    opts: { signal?: AbortSignal; body?: unknown; etag?: string },
    flags: { allow404?: boolean; allowGone?: boolean; listCall?: boolean } = {}
  ): Promise<T> {
    let attempt = 0
    let retried401 = false
    for (;;) {
      const token = await this.auth.getAccessToken(opts.signal)
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
      if (opts.body !== undefined) headers['content-type'] = 'application/json'
      if (opts.etag) headers['If-Match'] = opts.etag

      let res: Response
      try {
        res = await this.http.fetch(url, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: opts.signal
        })
      } catch (err) {
        throw new SyncError('network', String(err))
      }

      if (res.ok) {
        if (method === 'DELETE') return undefined as T
        return (await res.json()) as T
      }

      if (res.status === 404 && flags.allow404) return (method === 'DELETE' ? 'missing' : undefined) as T
      if (res.status === 410 && flags.allowGone) return undefined as T
      if (res.status === 401 && !retried401) {
        retried401 = true
        this.auth.invalidateAccessToken()
        continue
      }
      if (res.status === 409 || res.status === 412) throw new SyncError('conflict', await safeText(res))
      if (res.status === 410 && flags.listCall) throw new SyncError('sync_token_expired', await safeText(res))

      const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && (await isRateLimited(res)))
      if (retryable && attempt < MAX_RETRIES) {
        attempt++
        const backoff = 2 ** attempt * 500 + Math.floor(Math.random() * 250)
        await sleep(this.clock, backoff)
        continue
      }

      throw new SyncError(res.status >= 500 ? 'server' : 'unknown', `${method} ${url} -> ${res.status} ${await safeText(res)}`)
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

async function isRateLimited(res: Response): Promise<boolean> {
  try {
    const clone = res.clone()
    const body = (await clone.json()) as { error?: { errors?: { reason?: string }[] } }
    const reason = body?.error?.errors?.[0]?.reason
    return reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'
  } catch {
    return false
  }
}

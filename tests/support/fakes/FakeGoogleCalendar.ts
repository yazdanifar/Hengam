import type { GoogleEventResource } from '@main/sync/GoogleCalendarClient'
import type { FakeHttpClient } from './FakeHttpClient'

/**
 * A stateful stand-in for the Calendar API's events endpoints, installed onto a
 * FakeHttpClient. Mirrors the behavior duplicate-prevention relies on: client-chosen ids,
 * 409 for an id already used (even by a deleted event), deleted events kept as
 * 'cancelled' (GET returns them, DELETE on them is 410), and lists that include them.
 * Every list is a full listing, so each sync re-applies everything: a stress test for
 * dedupe rather than an incremental-sync simulation.
 */
export class FakeGoogleCalendar {
  private store = new Map<string, Map<string, GoogleEventResource>>()
  private seq = 0
  /** When set, the next matching request is applied on the server but its response is
   *  lost (the fetch throws), as with a timeout or a crash mid-request. */
  loseNextResponse?: (method: string) => boolean
  /** Makes event listing fail, so a run pushes but can't pull (e.g. the app quit mid-run). */
  breakLists = false

  install(http: FakeHttpClient, apiBase = 'https://www.googleapis.com/calendar/v3'): this {
    const prefix = `${apiBase}/calendars/`
    http.on(
      (url) => url.startsWith(prefix),
      async (url, init) => {
        const method = init?.method ?? 'GET'
        const [path, query] = url.slice(prefix.length).split('?')
        const [calEnc, , idEnc, sub] = path.split('/')
        const res =
          sub === 'instances'
            ? this.handleInstances(decodeURIComponent(calEnc), decodeURIComponent(idEnc), new URLSearchParams(query))
            : this.handle(method, decodeURIComponent(calEnc), idEnc && decodeURIComponent(idEnc), init?.body)
        if (this.loseNextResponse?.(method)) {
          this.loseNextResponse = undefined
          throw new Error('socket hang up')
        }
        return res
      }
    )
    return this
  }

  /** Seeds an event as if created in Google Calendar itself. */
  seed(calendarId: string, ev: Omit<GoogleEventResource, 'etag' | 'updated'>): GoogleEventResource {
    return this.put(calendarId, { status: 'confirmed', ...ev })
  }

  /** Moves an event between calendars the way Google does: same id, cancelled at the source. */
  move(fromCalendarId: string, toCalendarId: string, id: string): void {
    const ev = this.cal(fromCalendarId).get(id)!
    this.put(fromCalendarId, { ...ev, status: 'cancelled' })
    this.put(toCalendarId, { ...ev, status: 'confirmed' })
  }

  live(calendarId: string): GoogleEventResource[] {
    return [...this.cal(calendarId).values()].filter((e) => e.status !== 'cancelled')
  }

  private cal(calendarId: string): Map<string, GoogleEventResource> {
    let c = this.store.get(calendarId)
    if (!c) this.store.set(calendarId, (c = new Map()))
    return c
  }

  private put(calendarId: string, ev: GoogleEventResource): GoogleEventResource {
    this.seq++
    const stored = { ...ev, etag: `"e${this.seq}"`, updated: new Date(Date.UTC(2026, 8, 23, 10, 0, this.seq)).toISOString() }
    this.cal(calendarId).set(ev.id, stored)
    return stored
  }

  /** GET .../events/{recurringEventId}/instances?originalStart=... — finds a previously
   *  seeded or inserted instance (an event with a matching recurringEventId and
   *  originalStartTime) instead of expanding the parent's rule itself. */
  private handleInstances(calendarId: string, recurringEventId: string, query: URLSearchParams): Response {
    const json = (status: number, body?: unknown): Response =>
      new Response(body === undefined ? null : JSON.stringify(body), { status })
    const originalStart = query.get('originalStart')
    const match = [...this.cal(calendarId).values()].find((e) => {
      if (e.recurringEventId !== recurringEventId) return false
      const at = e.originalStartTime?.dateTime ?? e.originalStartTime?.date
      return at === originalStart
    })
    return json(200, { items: match ? [match] : [] })
  }

  private handle(method: string, calendarId: string, id: string | undefined, rawBody: unknown): Response {
    const json = (status: number, body?: unknown): Response =>
      new Response(body === undefined ? null : JSON.stringify(body), { status })
    const body = typeof rawBody === 'string' ? (JSON.parse(rawBody) as GoogleEventResource) : undefined
    const cal = this.cal(calendarId)

    if (method === 'GET' && !id && this.breakLists) return json(400)
    if (method === 'GET' && !id) return json(200, { items: [...cal.values()], nextSyncToken: `tok${this.seq}` })
    if (method === 'POST') {
      const newId = body!.id ?? `gen${this.seq + 1}`
      if (cal.has(newId)) return json(409, { error: { code: 409, message: 'The requested identifier already exists.' } })
      return json(200, this.put(calendarId, { ...body!, id: newId, status: 'confirmed' }))
    }

    const existing = id ? cal.get(id) : undefined
    if (!existing) return json(404)
    if (method === 'GET') return json(200, existing)
    if (method === 'PATCH') return json(200, this.put(calendarId, { ...existing, ...body!, id: existing.id }))
    if (method === 'DELETE') {
      if (existing.status === 'cancelled') return json(410)
      this.put(calendarId, { ...existing, status: 'cancelled' })
      return json(204)
    }
    return json(405)
  }
}

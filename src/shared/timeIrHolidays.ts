import type { RawHolidayDay } from './holidays'
import type { HolidayErrorCode } from './events'

// Fetches one Jalali year's official holidays/occasions directly from time.ir.
// time.ir has no public API: its api.time.ir backend needs a server-side key,
// and the site reaches it through a Next.js Server Action. We call that action
// the way its own /event-year page does (one POST per year, body `[year]`).
//
// Used by both HolidayService (daily runtime refresh, via electronAdapters.ts)
// and scripts/fetch-holidays.mjs (rebuilding the bundled year files offline).

const ORIGIN = 'https://www.time.ir'
const PAGE = `${ORIGIN}/event-year`
const ACTION_NAME = 'fetchEventYearlyCalendarAction'

// time.ir answers 403 without browser-like origin/referer/user-agent headers.
const BROWSER_HEADERS = {
  origin: ORIGIN,
  referer: PAGE,
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
}

// No TypeScript parameter properties in this file: scripts/fetch-holidays.mjs runs it
// under Node's strip-only type support, which rejects them.

/** A failed fetch, with a stable code the renderer maps to Persian text. */
export class HolidayFetchError extends Error {
  readonly code: HolidayErrorCode

  constructor(code: HolidayErrorCode, message: string) {
    super(message)
    this.name = 'HolidayFetchError'
    this.code = code
  }
}

interface TimeIrEvent {
  jalali_year: number
  jalali_month: number
  jalali_day: number
  title: string
  is_holiday: boolean
}

interface TimeIrMonth {
  event_list: TimeIrEvent[]
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Splits a React Flight (RSC) response into rows keyed by id. A row is either
 * `<id>:<json>\n` or `<id>:T<hex byte length>,<text>` (long HTML event bodies);
 * text rows can contain newlines, so the stream must be walked by length, not
 * split on '\n'.
 */
export function rscRows(buf: Buffer): Map<string, string> {
  const rows = new Map<string, string>()
  let i = 0
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i) // ':'
    if (colon < 0) break
    const id = buf.toString('utf8', i, colon)
    if (buf[colon + 1] === 0x54 /* 'T' */) {
      const comma = buf.indexOf(0x2c, colon) // ','
      const len = parseInt(buf.toString('utf8', colon + 2, comma), 16)
      rows.set(id, buf.toString('utf8', comma + 1, comma + 1 + len))
      i = comma + 1 + len
    } else {
      let nl = buf.indexOf(0x0a, colon) // '\n'
      if (nl < 0) nl = buf.length
      rows.set(id, buf.toString('utf8', colon + 1, nl))
      i = nl + 1
    }
  }
  return rows
}

/** Converts time.ir's yearly-calendar months into RawHolidayDay[] (see holidays.ts). */
export function toRawHolidayDays(jy: number, months: TimeIrMonth[]): RawHolidayDay[] {
  const days = new Map<string, RawHolidayDay>()
  for (const month of months) {
    for (const e of month.event_list) {
      if (e.jalali_year !== jy) continue
      const date = `${jy}-${String(e.jalali_month).padStart(2, '0')}-${String(e.jalali_day).padStart(2, '0')}`
      const day = days.get(date) ?? { date, events: [], is_holiday: false }
      const description = e.title.replace(/\s+/g, ' ').trim()
      if (!day.events.some((x) => x.description === description)) {
        day.events.push({ description, is_holiday: e.is_holiday })
      }
      day.is_holiday ||= e.is_holiday
      days.set(date, day)
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * One client per long-lived owner (the app's holiday feed, or one script run).
 * The Server Action id is a build hash that changes on every time.ir deploy, so
 * it's looked up by its exported name and cached; if a call with the cached id
 * fails, the id is looked up again once, since the site may have redeployed.
 */
export class TimeIrClient {
  private actionId: string | undefined
  private fetchFn: FetchFn

  constructor(fetchFn: FetchFn = (url, init) => fetch(url, init)) {
    this.fetchFn = fetchFn
  }

  /**
   * Fetches and validates one Jalali year's holidays/occasions. Throws a
   * HolidayFetchError on any failure or implausible result (wrong month count,
   * Nowruz not a holiday, a holiday count outside the normal range) rather than
   * returning a partial or empty year; callers keep whatever data they had.
   */
  async fetchYear(jy: number): Promise<RawHolidayDay[]> {
    const hadCachedId = this.actionId !== undefined
    let months: TimeIrMonth[]
    try {
      months = await this.fetchMonths(await this.findActionId(), jy)
    } catch (err) {
      if (!hadCachedId || !(err instanceof HolidayFetchError) || err.code === 'network') throw err
      this.actionId = undefined
      months = await this.fetchMonths(await this.findActionId(), jy)
    }
    return validateYear(jy, months)
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    let res: Response
    try {
      res = await this.fetchFn(url, init)
    } catch (err) {
      throw new HolidayFetchError('network', `time.ir: ${url}: ${(err as Error).message}`)
    }
    if (!res.ok) {
      const code = res.status === 403 || res.status === 429 ? 'blocked' : 'server'
      throw new HolidayFetchError(code, `time.ir: ${init?.method ?? 'GET'} ${url}: ${res.status}`)
    }
    return res
  }

  private async findActionId(): Promise<string> {
    if (this.actionId) return this.actionId
    const html = await (await this.request(PAGE, { headers: BROWSER_HEADERS })).text()
    const chunks = [...new Set(html.match(/\/_next\/static\/[^"\\]+\.js/g) ?? [])]
    const re = new RegExp(`createServerReference\\)?\\("([0-9a-f]{40,})"[^)]*"${ACTION_NAME}"\\)`)
    for (const chunk of chunks) {
      const m = (await (await this.request(ORIGIN + chunk, { headers: BROWSER_HEADERS })).text()).match(re)
      if (m) return (this.actionId = m[1])
    }
    throw new HolidayFetchError('site_changed', `time.ir: ${ACTION_NAME} not found in ${chunks.length} script chunks`)
  }

  private async fetchMonths(actionId: string, jy: number): Promise<TimeIrMonth[]> {
    const res = await this.request(PAGE, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'next-action': actionId,
        accept: 'text/x-component',
        'content-type': 'text/plain;charset=UTF-8'
      },
      body: JSON.stringify([jy])
    })
    // Row 0 is the action envelope ({"a":"$@1",...}); row 1 is api.time.ir's JSON.
    const row = rscRows(Buffer.from(await res.arrayBuffer())).get('1')
    if (!row || row.startsWith('E')) {
      throw new HolidayFetchError('site_changed', `time.ir: year ${jy}: action failed: ${row}`)
    }
    let body: { status_code?: number; message?: string; data?: unknown }
    try {
      body = JSON.parse(row)
    } catch {
      throw new HolidayFetchError('site_changed', `time.ir: year ${jy}: unreadable action response`)
    }
    if (body.status_code !== 200 || !Array.isArray(body.data)) {
      throw new HolidayFetchError('server', `time.ir: year ${jy}: api said ${body.status_code} ${body.message}`)
    }
    return body.data as TimeIrMonth[]
  }
}

function validateYear(jy: number, months: TimeIrMonth[]): RawHolidayDay[] {
  if (months.length !== 12) {
    throw new HolidayFetchError('invalid_data', `time.ir: year ${jy}: expected 12 months, got ${months.length}`)
  }
  const days = toRawHolidayDays(jy, months)
  const holidayCount = days.filter((d) => d.is_holiday).length
  if (!days.find((d) => d.date === `${jy}-01-01`)?.is_holiday) {
    throw new HolidayFetchError('invalid_data', `time.ir: year ${jy}: 1 Farvardin is not a holiday`)
  }
  if (holidayCount < 20 || holidayCount > 35) {
    throw new HolidayFetchError('invalid_data', `time.ir: year ${jy}: implausible holiday count ${holidayCount}`)
  }
  return days
}

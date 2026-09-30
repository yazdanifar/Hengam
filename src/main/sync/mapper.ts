// Maps between Hengam's local event shape and the Google Calendar API's event
// resource, including recurrence. Google's RRULE is Gregorian-only, so Jalali
// monthly/yearly rules are sent as an explicit RDATE list plus a private
// extended property that round-trips the original rule exactly.
import { addJalaliMonths, toGregorian, toJalali } from '@shared/jalali'
import { MAX_REMINDERS, normalizeReminders } from '@shared/reminders'
import type { RecurrenceRule } from '@shared/types'

const WEEKDAY_CODES = ['SA', 'SU', 'MO', 'TU', 'WE', 'TH', 'FR'] // index 0=Saturday, matching our byWeekday convention

export interface GoogleEventLike {
  /** Only ever set on insert, to make the insert idempotent. */
  id?: string
  summary: string
  description?: string
  start: { date?: string; dateTime?: string; timeZone?: string }
  end: { date?: string; dateTime?: string; timeZone?: string }
  colorId?: string
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] }
  recurrence?: string[]
  extendedProperties?: { private?: Record<string, string> }
}

export interface LocalEventLike {
  title: string
  notes?: string
  startTs: number
  endTs: number
  allDay: boolean
  rrule?: RecurrenceRule
  reminders?: number[]
  colorId?: string
  /** Occurrence starts (of this event's own rule) to leave out of a Jalali RDATE list —
   *  the local starts of occurrences the user has skipped. */
  skipStarts?: number[]
}

function toRfc3339(ts: number): string {
  return new Date(ts).toISOString()
}

function toDateOnly(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The `originalStart` value Google's `events.instances` endpoint expects to look up one
 *  occurrence — an RFC 3339 instant for timed events, a bare date for all-day ones. Mirrors
 *  how a pulled instance's `originalStartTime` is turned back into an occurrenceStartTs. */
export function originalStartFor(occurrenceStartTs: number, allDay: boolean): string {
  return allDay ? toDateOnly(occurrenceStartTs) : toRfc3339(occurrenceStartTs)
}

/** The starts of a Jalali monthly/yearly rule's occurrences after the first (the event's
 *  own start, never repeated in RDATE), `years` ahead. Mirrors the local expansion in
 *  recurrence.ts exactly, so the timestamps compare equal to local occurrence starts. */
function jalaliOccurrenceStarts(startTs: number, rule: RecurrenceRule, years: number): number[] {
  const startJ = toJalali(new Date(startTs))
  const timeOfDay = startTs - new Date(startTs).setHours(0, 0, 0, 0)
  const stepMonths = rule.freq === 'monthly' ? rule.interval : rule.interval * 12
  const count = rule.count ?? Math.ceil((years * 12) / stepMonths)
  const out: number[] = []
  for (let i = 1; i < count; i++) {
    const occJ = addJalaliMonths(startJ.jy, startJ.jm, startJ.jd, stepMonths * i)
    const occTs = toGregorian(occJ.jy, occJ.jm, occJ.jd).getTime() + timeOfDay
    if (rule.until && occTs > rule.until) break
    out.push(occTs)
  }
  return out
}

/** Generates the Jalali monthly/yearly occurrence starts as RDATE values, `years` ahead.
 *  Occurrences whose start is in `skipStarts` (locally skipped occurrences) are left out,
 *  so a re-push doesn't resurrect a deleted occurrence on Google. */
function generateJalaliRDates(startTs: number, rule: RecurrenceRule, years: number, skipStarts?: number[]): string[] {
  const skip = new Set(skipStarts)
  return jalaliOccurrenceStarts(startTs, rule, years)
    .filter((ts) => !skip.has(ts))
    .map((ts) => toRfc3339(ts).replace(/\.\d{3}Z$/, 'Z'))
}

const RDATE_YEARS = 3

/** One RDATE value as a UTC instant: our own `2026-02-01T09:00:00Z` form, or iCal's basic
 *  `20260201T090000Z` (in case Google normalizes it). NaN for anything else. */
function parseRDateValue(v: string): number {
  const basic = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v)
  if (basic) {
    const [, y, mo, d, h, mi, se] = basic.map(Number)
    return Date.UTC(y, mo - 1, d, h, mi, se)
  }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? Date.parse(v) : NaN
}

/**
 * The occurrence starts a Jalali monthly/yearly event's rule produces but its RDATE list
 * leaves out — occurrences skipped (by any Hengam device) through the RDATE list, which
 * Google never reports as cancelled instances. Empty when the event isn't a Jalali series,
 * or when any RDATE value can't be read (never guess a deletion from a format we don't know).
 */
export function jalaliSkippedStarts(g: GoogleEventLike): number[] {
  const ruleJson = g.extendedProperties?.private?.jalaliRule
  if (!ruleJson) return []
  const rule = JSON.parse(ruleJson) as RecurrenceRule
  if (!isJalaliOnlyFreq(rule.freq)) return []

  const present = new Set<number>()
  for (const line of g.recurrence ?? []) {
    const colon = line.indexOf(':')
    if (!/^RDATE[;:]/.test(line) || colon < 0) continue
    for (const value of line.slice(colon + 1).split(',')) {
      const ts = parseRDateValue(value.trim())
      if (Number.isNaN(ts)) return []
      present.add(ts)
    }
  }
  const { startTs } = fromGoogleEvent(g)
  return jalaliOccurrenceStarts(startTs, rule, RDATE_YEARS).filter((ts) => !present.has(ts))
}

function isJalaliOnlyFreq(freq: RecurrenceRule['freq']): boolean {
  return freq === 'monthly' || freq === 'yearly'
}

export function toGoogleEvent(ev: LocalEventLike): GoogleEventLike {
  const g: GoogleEventLike = {
    summary: ev.title,
    description: ev.notes,
    start: ev.allDay ? { date: toDateOnly(ev.startTs) } : { dateTime: toRfc3339(ev.startTs), timeZone: 'Asia/Tehran' },
    end: ev.allDay ? { date: toDateOnly(ev.endTs) } : { dateTime: toRfc3339(ev.endTs), timeZone: 'Asia/Tehran' },
    colorId: ev.colorId,
    reminders: ev.reminders?.length
      ? {
          useDefault: false,
          overrides: normalizeReminders(ev.reminders)
            .slice(0, MAX_REMINDERS)
            .map((minutes) => ({ method: 'popup', minutes }))
        }
      : { useDefault: false }
  }

  if (ev.rrule) {
    if (isJalaliOnlyFreq(ev.rrule.freq)) {
      const rdates = generateJalaliRDates(ev.startTs, ev.rrule, RDATE_YEARS, ev.skipStarts)
      g.recurrence = rdates.length ? [`RDATE:${rdates.join(',')}`] : undefined
      g.extendedProperties = { private: { jalaliRule: JSON.stringify(ev.rrule) } }
    } else {
      const parts = [`FREQ=${ev.rrule.freq.toUpperCase()}`, `INTERVAL=${ev.rrule.interval}`]
      if (ev.rrule.byWeekday?.length) {
        parts.push(`BYDAY=${ev.rrule.byWeekday.map((w) => WEEKDAY_CODES[w]).join(',')}`)
      }
      if (ev.rrule.until) parts.push(`UNTIL=${toRfc3339(ev.rrule.until).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`)
      if (ev.rrule.count) parts.push(`COUNT=${ev.rrule.count}`)
      g.recurrence = [`RRULE:${parts.join(';')}`]
    }
  }

  return g
}

function parseRRuleLine(line: string): RecurrenceRule {
  const body = line.replace(/^RRULE:/, '')
  const fields = Object.fromEntries(body.split(';').map((p) => p.split('=') as [string, string]))
  const freq = (fields.FREQ ?? 'DAILY').toLowerCase() as RecurrenceRule['freq']
  const rule: RecurrenceRule = { freq, interval: fields.INTERVAL ? Number(fields.INTERVAL) : 1 }
  if (fields.BYDAY) {
    rule.byWeekday = fields.BYDAY.split(',').map((code) => WEEKDAY_CODES.indexOf(code))
  }
  if (fields.COUNT) rule.count = Number(fields.COUNT)
  if (fields.UNTIL) {
    const raw = fields.UNTIL
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
    rule.until = new Date(iso).getTime()
  }
  return rule
}

export function fromGoogleEvent(g: GoogleEventLike): LocalEventLike {
  const allDay = !!g.start.date
  const startTs = allDay ? new Date(g.start.date + 'T00:00:00').getTime() : new Date(g.start.dateTime!).getTime()
  const endTs = allDay ? new Date(g.end.date + 'T00:00:00').getTime() : new Date(g.end.dateTime!).getTime()

  let rrule: RecurrenceRule | undefined
  const jalaliRuleJson = g.extendedProperties?.private?.jalaliRule
  if (jalaliRuleJson) {
    rrule = JSON.parse(jalaliRuleJson) as RecurrenceRule
  } else if (g.recurrence?.length) {
    const rruleLine = g.recurrence.find((l) => l.startsWith('RRULE:'))
    if (rruleLine) {
      rrule = parseRRuleLine(rruleLine)
    } else {
      // A bare RDATE list with no jalaliRule extended property: not one of ours,
      // and not Jalali-expressible either; the caller treats this as a raw/read-only rule.
      rrule = { freq: 'daily', interval: 1 }
    }
  }

  return {
    title: g.summary,
    notes: g.description,
    startTs,
    endTs,
    allDay,
    rrule,
    reminders: normalizeReminders(
      (g.reminders?.overrides ?? []).filter((o) => o.method === 'popup').map((o) => o.minutes)
    ),
    colorId: g.colorId
  }
}

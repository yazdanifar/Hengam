import type { EventException, EventRecord, Occurrence, RecurrenceRule } from './types'
import { addJalaliMonths, toGregorian, toJalali } from './jalali'

const DAY_MS = 24 * 60 * 60 * 1000

function toOccurrence(ev: EventRecord, occurrenceStartTs: number, startTs: number, endTs: number): Occurrence {
  return {
    eventId: ev.id,
    occurrenceStartTs,
    title: ev.title,
    notes: ev.notes,
    color: ev.color,
    startTs,
    endTs,
    allDay: ev.allDay,
    isRecurring: !!ev.rrule
  }
}

function applyException(
  base: Occurrence,
  exceptions: Map<number, EventException>
): Occurrence | null {
  const ex = exceptions.get(base.occurrenceStartTs)
  if (!ex) return base
  if (ex.kind === 'skip') return null
  return {
    ...base,
    title: ex.override?.title ?? base.title,
    notes: ex.override?.notes ?? base.notes,
    color: ex.override?.color ?? base.color,
    startTs: ex.override?.startTs ?? base.startTs,
    endTs: ex.override?.endTs ?? base.endTs
  }
}

/**
 * Expand a single event (with an optional recurrence rule) into the occurrences
 * that intersect [rangeStart, rangeEnd), applying skip/override exceptions.
 * The returned list is sorted by start time ascending, has no duplicates and
 * never exceeds `rule.count` total generated occurrences (before range filtering).
 */
export function expandOccurrences(
  ev: EventRecord,
  rangeStart: number,
  rangeEnd: number,
  exceptions: EventException[] = []
): Occurrence[] {
  const duration = ev.endTs - ev.startTs
  const exMap = new Map(exceptions.map((e) => [e.occurrenceStartTs, e]))
  const out: Occurrence[] = []

  const pushIfInRange = (occurrenceStartTs: number, startTs: number) => {
    const endTs = startTs + duration
    // An occurrence intersects the range if it starts before rangeEnd and ends after rangeStart.
    if (startTs < rangeEnd && endTs > rangeStart) {
      const base = toOccurrence(ev, occurrenceStartTs, startTs, endTs)
      const withEx = applyException(base, exMap)
      if (withEx) out.push(withEx)
    } else {
      // An override may have moved the occurrence outside/inside the range independent of its
      // original slot; check the overridden version too.
      const ex = exMap.get(occurrenceStartTs)
      if (ex && ex.kind === 'override') {
        const oStart = ex.override?.startTs ?? startTs
        const oEnd = ex.override?.endTs ?? oStart + duration
        if (oStart < rangeEnd && oEnd > rangeStart) {
          const base = toOccurrence(ev, occurrenceStartTs, startTs, endTs)
          const withEx = applyException(base, exMap)
          if (withEx) out.push(withEx)
        }
      }
    }
  }

  if (!ev.rrule) {
    pushIfInRange(ev.startTs, ev.startTs)
    return out
  }

  const rule = ev.rrule
  let generated = 0
  const maxGenerated = rule.count ?? Infinity
  const until = rule.until ?? Infinity

  if (rule.freq === 'daily' || rule.freq === 'weekly') {
    const stepDays = rule.freq === 'daily' ? rule.interval : rule.interval * 7
    const startDay = new Date(ev.startTs)
    startDay.setHours(0, 0, 0, 0)
    const timeOfDay = ev.startTs - new Date(ev.startTs).setHours(0, 0, 0, 0)

    if (rule.freq === 'weekly' && rule.byWeekday && rule.byWeekday.length > 0) {
      // Walk week-by-week from the event's own week start (Saturday), emitting the
      // requested weekdays each `interval` weeks.
      const weekStart = new Date(startDay)
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 1) % 7))
      let weekIndex = 0
      // Safety bound: 20 years of weeks is far more than any UI range needs.
      for (; weekIndex < 20 * 53 && generated < maxGenerated; weekIndex++) {
        if (weekIndex % rule.interval !== 0) continue
        const thisWeekStart = new Date(weekStart)
        thisWeekStart.setDate(thisWeekStart.getDate() + weekIndex * 7)
        if (thisWeekStart.getTime() - DAY_MS * 7 > rangeEnd) break
        for (const wd of rule.byWeekday) {
          const occDay = new Date(thisWeekStart)
          occDay.setDate(occDay.getDate() + wd)
          const occStart = occDay.getTime() + timeOfDay
          if (occStart < ev.startTs) continue
          if (occStart > until) continue
          if (generated >= maxGenerated) break
          generated++
          pushIfInRange(occStart, occStart)
        }
      }
    } else {
      let occStart = ev.startTs
      let i = 0
      while (generated < maxGenerated) {
        occStart = ev.startTs + i * stepDays * DAY_MS
        if (occStart > until) break
        if (occStart - stepDays * DAY_MS * 2 > rangeEnd) break
        generated++
        pushIfInRange(occStart, occStart)
        i++
        if (i > 100000) break // hard safety cap
      }
    }
  } else {
    // monthly / yearly, on the Jalali calendar
    const startJ = toJalali(new Date(ev.startTs))
    const timeOfDay = ev.startTs - new Date(ev.startTs).setHours(0, 0, 0, 0)
    const stepMonths = rule.freq === 'monthly' ? rule.interval : rule.interval * 12
    let i = 0
    while (generated < maxGenerated) {
      const occJ = addJalaliMonths(startJ.jy, startJ.jm, startJ.jd, stepMonths * i)
      const occStart = toGregorian(occJ.jy, occJ.jm, occJ.jd).getTime() + timeOfDay
      if (occStart > until) break
      // Roughly bound how far past the range we walk before giving up.
      if (occStart - stepMonths * 32 * DAY_MS > rangeEnd) break
      generated++
      pushIfInRange(occStart, occStart)
      i++
      if (i > 10000) break
    }
  }

  out.sort((a, b) => a.startTs - b.startTs)
  return out
}

export function makeDailyRule(interval = 1, opts: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { freq: 'daily', interval, ...opts }
}

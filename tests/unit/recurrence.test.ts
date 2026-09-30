import { describe, expect, it } from 'vitest'
import { expandOccurrences } from '@shared/recurrence'
import { toGregorian } from '@shared/jalali'
import type { EventRecord } from '@shared/types'

function baseEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  const start = toGregorian(1405, 6, 31).getTime() + 9 * 3600_000 // 09:00
  return {
    id: 'e1',
    title: 'جلسه',
    color: '#3b82f6',
    startTs: start,
    endTs: start + 3600_000,
    allDay: false,
    reminders: [],
    createdAt: 0,
    updatedAt: 0,
    dirty: false,
    ...overrides,
    editSeq: overrides.editSeq ?? 0
  }
}

const YEAR_RANGE_START = toGregorian(1405, 1, 1).getTime()
const YEAR_RANGE_END = toGregorian(1406, 1, 1).getTime()

describe('expandOccurrences: weekly', () => {
  it('every Saturday and Monday', () => {
    const ev = baseEvent({
      startTs: toGregorian(1405, 6, 28).getTime() + 9 * 3600_000, // a Saturday
      endTs: toGregorian(1405, 6, 28).getTime() + 10 * 3600_000,
      rrule: { freq: 'weekly', interval: 1, byWeekday: [0, 2] } // Sat, Mon
    })
    const rangeStart = toGregorian(1405, 6, 28).getTime()
    const rangeEnd = rangeStart + 14 * 86400_000 // two weeks
    const occ = expandOccurrences(ev, rangeStart, rangeEnd)
    expect(occ.length).toBe(4) // 2 weeks * 2 weekdays
    for (const o of occ) {
      const day = new Date(o.startTs).getDay() // 6=Sat, 1=Mon
      expect([6, 1]).toContain(day)
    }
  })
})

describe('expandOccurrences: monthly clamping', () => {
  it('the 31st clamps to the 30th in Mehr', () => {
    const ev = baseEvent({
      startTs: toGregorian(1405, 6, 31).getTime() + 9 * 3600_000,
      endTs: toGregorian(1405, 6, 31).getTime() + 10 * 3600_000,
      rrule: { freq: 'monthly', interval: 1, count: 3 }
    })
    const occ = expandOccurrences(ev, YEAR_RANGE_START, toGregorian(1406, 3, 1).getTime())
    expect(occ.length).toBe(3)
    // 2nd occurrence should land in Mehr (30 days), clamped to day 30
    const dates = occ.map((o) => new Date(o.startTs))
    expect(dates[1].getDate()).toBeLessThanOrEqual(30)
  })

  it('yearly on 30 Esfand clamps in a non-leap year', () => {
    const ev = baseEvent({
      startTs: toGregorian(1404, 12, 30).getTime() + 9 * 3600_000,
      endTs: toGregorian(1404, 12, 30).getTime() + 10 * 3600_000,
      rrule: { freq: 'yearly', interval: 1, count: 2 }
    })
    const occ = expandOccurrences(ev, toGregorian(1404, 1, 1).getTime(), toGregorian(1407, 1, 1).getTime())
    expect(occ.length).toBe(2)
  })
})

describe('expandOccurrences: limits', () => {
  it('respects until', () => {
    const start = toGregorian(1405, 1, 1).getTime() + 9 * 3600_000
    const ev = baseEvent({
      startTs: start,
      endTs: start + 3600_000,
      rrule: { freq: 'daily', interval: 1, until: start + 3 * 86400_000 }
    })
    const occ = expandOccurrences(ev, start, start + 30 * 86400_000)
    expect(occ.length).toBe(4) // day 0,1,2,3
  })

  it('respects count', () => {
    const start = toGregorian(1405, 1, 1).getTime() + 9 * 3600_000
    const ev = baseEvent({ startTs: start, endTs: start + 3600_000, rrule: { freq: 'daily', interval: 1, count: 5 } })
    const occ = expandOccurrences(ev, start, start + 100 * 86400_000)
    expect(occ.length).toBe(5)
  })
})

describe('expandOccurrences: exceptions', () => {
  const start = toGregorian(1405, 1, 1).getTime() + 9 * 3600_000
  it('a skipped occurrence is omitted', () => {
    const ev = baseEvent({ startTs: start, endTs: start + 3600_000, rrule: { freq: 'daily', interval: 1, count: 5 } })
    const secondOccStart = start + 86400_000
    const occ = expandOccurrences(ev, start, start + 10 * 86400_000, [
      { eventId: ev.id, occurrenceStartTs: secondOccStart, kind: 'skip' }
    ])
    expect(occ.length).toBe(4)
    expect(occ.find((o) => o.occurrenceStartTs === secondOccStart)).toBeUndefined()
  })

  it('an override can move an occurrence, including outside its original slot', () => {
    const ev = baseEvent({ startTs: start, endTs: start + 3600_000, rrule: { freq: 'daily', interval: 1, count: 3 } })
    const movedTo = start + 5 * 86400_000 + 2 * 3600_000
    const occ = expandOccurrences(ev, start, start + 10 * 86400_000, [
      {
        eventId: ev.id,
        occurrenceStartTs: start,
        kind: 'override',
        override: { startTs: movedTo, endTs: movedTo + 3600_000, title: 'جلسه جابجا شده' }
      }
    ])
    const moved = occ.find((o) => o.occurrenceStartTs === start)
    expect(moved?.startTs).toBe(movedTo)
    expect(moved?.title).toBe('جلسه جابجا شده')
  })
})

describe('expandOccurrences: properties', () => {
  it('output is sorted, has no duplicate occurrenceStartTs, and never exceeds count', () => {
    const start = toGregorian(1405, 1, 1).getTime() + 9 * 3600_000
    const ev = baseEvent({ startTs: start, endTs: start + 3600_000, rrule: { freq: 'daily', interval: 1, count: 10 } })
    const occ = expandOccurrences(ev, start, start + 100 * 86400_000)
    expect(occ.length).toBeLessThanOrEqual(10)
    const starts = occ.map((o) => o.startTs)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(new Set(occ.map((o) => o.occurrenceStartTs)).size).toBe(occ.length)
  })

  it('every occurrence intersects the requested range', () => {
    const start = toGregorian(1405, 1, 1).getTime() + 9 * 3600_000
    const ev = baseEvent({ startTs: start, endTs: start + 3600_000, rrule: { freq: 'weekly', interval: 1, byWeekday: [0, 3] } })
    const rangeStart = start + 20 * 86400_000
    const rangeEnd = rangeStart + 14 * 86400_000
    const occ = expandOccurrences(ev, rangeStart, rangeEnd)
    for (const o of occ) {
      expect(o.startTs).toBeLessThan(rangeEnd)
      expect(o.endTs).toBeGreaterThan(rangeStart)
    }
  })
})

describe('expandOccurrences: non-recurring', () => {
  it('a single event only appears when it intersects the range', () => {
    const ev = baseEvent()
    const inRange = expandOccurrences(ev, ev.startTs - 1000, ev.endTs + 1000)
    expect(inRange).toHaveLength(1)
    const outOfRange = expandOccurrences(ev, ev.endTs + 1000, ev.endTs + 2000)
    expect(outOfRange).toHaveLength(0)
  })
})

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { fromGoogleEvent, toGoogleEvent, type LocalEventLike } from '@main/sync/mapper'
import { toGregorian } from '@shared/jalali'

describe('mapper: round trips', () => {
  it('an all-day event', () => {
    const ev: LocalEventLike = { title: 'تعطیل', startTs: toGregorian(1405, 1, 1).getTime(), endTs: toGregorian(1405, 1, 2).getTime(), allDay: true }
    const g = toGoogleEvent(ev)
    expect(g.start.date).toBeDefined()
    const back = fromGoogleEvent(g)
    expect(back.title).toBe('تعطیل')
    expect(back.allDay).toBe(true)
  })

  it('an event with a reminder and a color', () => {
    const start = toGregorian(1405, 6, 31).getTime() + 9 * 3600_000
    const ev: LocalEventLike = { title: 'جلسه', startTs: start, endTs: start + 3600_000, allDay: false, reminders: [15], colorId: '5' }
    const g = toGoogleEvent(ev)
    const back = fromGoogleEvent(g)
    expect(back.reminders).toEqual([15])
    expect(back.colorId).toBe('5')
    expect(back.startTs).toBe(start)
  })

  it('several reminders survive the round trip, sorted and de-duplicated', () => {
    const start = toGregorian(1405, 6, 31).getTime() + 9 * 3600_000
    const ev: LocalEventLike = {
      title: 'جلسه',
      startTs: start,
      endTs: start + 3600_000,
      allDay: false,
      reminders: [60, 10, 60, 1440]
    }
    const back = fromGoogleEvent(toGoogleEvent(ev))
    expect(back.reminders).toEqual([10, 60, 1440])
  })

  it('a non-popup override coming back from Google (e.g. email) is ignored', () => {
    const start = toGregorian(1405, 6, 31).getTime() + 9 * 3600_000
    const g = toGoogleEvent({ title: 'جلسه', startTs: start, endTs: start + 3600_000, allDay: false })
    g.reminders = { useDefault: false, overrides: [{ method: 'email', minutes: 30 }, { method: 'popup', minutes: 5 }] }
    const back = fromGoogleEvent(g)
    expect(back.reminders).toEqual([5])
  })

  it('a weekly rule maps to RRULE and back', () => {
    const start = toGregorian(1405, 1, 1).getTime() + 9 * 3600_000
    const ev: LocalEventLike = {
      title: 'هفتگی',
      startTs: start,
      endTs: start + 3600_000,
      allDay: false,
      rrule: { freq: 'weekly', interval: 1, byWeekday: [0, 2], count: 5 }
    }
    const g = toGoogleEvent(ev)
    expect(g.recurrence?.[0]).toMatch(/^RRULE:FREQ=WEEKLY/)
    const back = fromGoogleEvent(g)
    expect(back.rrule).toEqual({ freq: 'weekly', interval: 1, byWeekday: [0, 2], count: 5 })
  })

  it('a Jalali monthly rule becomes RDATE plus the extended property, and restores exactly', () => {
    const start = toGregorian(1405, 6, 31).getTime() + 9 * 3600_000
    const ev: LocalEventLike = {
      title: 'ماهانه',
      startTs: start,
      endTs: start + 3600_000,
      allDay: false,
      rrule: { freq: 'monthly', interval: 1, count: 4 }
    }
    const g = toGoogleEvent(ev)
    expect(g.recurrence?.[0]).toMatch(/^RDATE:/)
    expect(g.extendedProperties?.private?.jalaliRule).toBeDefined()
    const back = fromGoogleEvent(g)
    expect(back.rrule).toEqual(ev.rrule)
  })

  it('an exception occurrence (single event, no rrule)', () => {
    const start = toGregorian(1405, 1, 5).getTime() + 14 * 3600_000
    const ev: LocalEventLike = { title: 'یک‌باره', startTs: start, endTs: start + 1800_000, allDay: false }
    const back = fromGoogleEvent(toGoogleEvent(ev))
    expect(back.rrule).toBeUndefined()
    expect(back.startTs).toBe(start)
    expect(back.endTs).toBe(start + 1800_000)
  })
})

describe('mapper: properties', () => {
  it('title, times and rule survive local -> google -> local for arbitrary events', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        fc.integer({ min: 1700000000000, max: 1800000000000 }),
        fc.integer({ min: 1, max: 4 * 3600_000 }),
        fc.constantFrom<RecurrenceRuleFreq>('daily', 'weekly', 'monthly', 'yearly'),
        (title, startTs, durationMs, freq) => {
          const rrule = { freq, interval: 1, count: 3 } as const
          const ev: LocalEventLike = { title, startTs, endTs: startTs + durationMs, allDay: false, rrule }
          const back = fromGoogleEvent(toGoogleEvent(ev))
          expect(back.title).toBe(title)
          expect(back.startTs).toBe(startTs)
          expect(back.endTs).toBe(startTs + durationMs)
          expect(back.rrule).toEqual(rrule)
        }
      ),
      { numRuns: 50 }
    )
  })
})

type RecurrenceRuleFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

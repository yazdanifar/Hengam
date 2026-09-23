import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  addJalaliMonths,
  monthLength,
  monthMatrix,
  startOfJalaliWeek,
  toGregorian,
  toJalali
} from '@shared/jalali'

describe('toJalali / toGregorian', () => {
  it('1 Farvardin 1405 is 2026-03-21', () => {
    const g = toGregorian(1405, 1, 1)
    expect(g.getFullYear()).toBe(2026)
    expect(g.getMonth()).toBe(2) // March, 0-indexed
    expect(g.getDate()).toBe(21)
  })

  it('1 Mehr 1405 is 2026-09-23', () => {
    const g = toGregorian(1405, 7, 1)
    expect(g.getFullYear()).toBe(2026)
    expect(g.getMonth()).toBe(8) // September
    expect(g.getDate()).toBe(23)
  })

  it('round-trips known dates', () => {
    for (let jy = 1400; jy <= 1410; jy++) {
      const g = toGregorian(jy, 1, 1)
      const back = toJalali(g)
      expect(back).toEqual({ jy, jm: 1, jd: 1 })
    }
  })

  it('round-trips every day of a leap and non-leap year (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1300, max: 1500 }), fc.integer({ min: 1, max: 12 }), (jy, jm) => {
        const len = monthLength(jy, jm)
        for (let jd = 1; jd <= len; jd++) {
          const g = toGregorian(jy, jm, jd)
          const back = toJalali(g)
          expect(back).toEqual({ jy, jm, jd })
        }
      }),
      { numRuns: 50 }
    )
  })
})

describe('startOfJalaliWeek', () => {
  it('always returns a Saturday, at or before the input, within 6 days', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1704000000000, max: 1893000000000 }), (ts) => {
        const d = new Date(ts)
        const start = startOfJalaliWeek(d)
        expect(start.getDay()).toBe(6) // Saturday
        expect(start.getTime()).toBeLessThanOrEqual(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime())
        const diffDays = (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86400000
        expect(diffDays).toBeGreaterThanOrEqual(0)
        expect(diffDays).toBeLessThanOrEqual(6)
      })
    )
  })
})

describe('monthMatrix', () => {
  it('has 42 cells and includes every day of the month', () => {
    const cells = monthMatrix(1405, 7) // Mehr, 30 days
    expect(cells).toHaveLength(42)
    const daysOfMonth = cells.filter((c) => c.jy === 1405 && c.jm === 7).map((c) => c.jd)
    expect(new Set(daysOfMonth).size).toBe(30)
    for (let d = 1; d <= 30; d++) expect(daysOfMonth).toContain(d)
  })
})

describe('addJalaliMonths / clamping', () => {
  it('clamps day 31 to the last day of Mehr (30 days)', () => {
    const r = addJalaliMonths(1405, 6, 31, 1) // Shahrivar 31 + 1 month -> Mehr
    expect(r).toEqual({ jy: 1405, jm: 7, jd: 30 })
  })

  it('clamps Esfand 30 in a non-leap year', () => {
    // 1405 is not a leap year (Esfand has 29 days)
    expect(monthLength(1405, 12)).toBe(29)
    const r = addJalaliMonths(1404, 12, 30, 12)
    expect(r.jd).toBeLessThanOrEqual(monthLength(r.jy, r.jm))
  })
})

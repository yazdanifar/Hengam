import { describe, expect, it } from 'vitest'
import { getDayInfo, parseYearData, sanitizeTitle, type HolidaySource } from '@shared/holidays'

describe('sanitizeTitle', () => {
  it('strips a trailing bracketed date annotation', () => {
    expect(sanitizeTitle('عید سعید فطر [ ١ شوال ]')).toBe('عید سعید فطر')
    expect(sanitizeTitle('روز جهانی نوروز [ 21 March ]')).toBe('روز جهانی نوروز')
  })
  it('leaves plain titles untouched', () => {
    expect(sanitizeTitle('جشن سیزده‌به‌در')).toBe('جشن سیزده‌به‌در')
  })
})

describe('parseYearData', () => {
  it('rejects the wrong shape', () => {
    expect(() => parseYearData({ not: 'an array' })).toThrow()
    expect(() => parseYearData([{ date: '1405-01-01' }])).toThrow() // missing events
  })
  it('parses a well-formed array', () => {
    const map = parseYearData([{ date: '1405-01-01', is_holiday: true, events: [] }])
    expect(map.get('1405-01-01')?.is_holiday).toBe(true)
  })
})

const sample = parseYearData([
  { date: '1405-01-01', is_holiday: true, events: [{ description: 'جشن نوروز', is_holiday: true }] },
  { date: '1405-06-31', is_holiday: false, events: [{ description: 'یک روز عادی', is_holiday: false }] }
])

const sourceWith1405: HolidaySource = { getYear: (jy) => (jy === 1405 ? sample : undefined) }
const sourceEmpty: HolidaySource = { getYear: () => undefined }

describe('getDayInfo', () => {
  it('1 Farvardin 1405 is a holiday', () => {
    const info = getDayInfo({ jy: 1405, jm: 1, jd: 1 }, sourceWith1405)
    expect(info.isHoliday).toBe(true)
    expect(info.events[0].title).toBe('جشن نوروز')
  })

  it('every Friday is a holiday regardless of the data file', () => {
    // 1405-06-31 (2026-09-22) is a Tuesday in this dataset, so build a known Friday instead.
    // 1405-01-06 = 2026-03-26, a Thursday; use jalali util indirectly via toGregorian in the module.
    // Simplest: pick a date we know is Friday from the earlier conversion tests (2026-09-25 is a Friday, Jalali 1405-07-03).
    const info = getDayInfo({ jy: 1405, jm: 7, jd: 3 }, sourceEmpty)
    expect(info.isHoliday).toBe(true)
  })

  it('falls back to the fixed list and flags incomplete for years with no data file', () => {
    const info = getDayInfo({ jy: 1410, jm: 1, jd: 1 }, sourceEmpty)
    expect(info.isHoliday).toBe(true) // Nowruz is in the fixed list
    expect(info.incomplete).toBe(true)
  })

  it('a non-holiday day in a known year is not a holiday', () => {
    const info = getDayInfo({ jy: 1405, jm: 6, jd: 31 }, sourceWith1405)
    // 1405-06-31 is a Tuesday, not in FIXED_HOLIDAYS, and marked is_holiday:false in the sample
    expect(info.isHoliday).toBe(false)
  })
})

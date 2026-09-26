import type { DayInfo, HolidayEvent } from './types'
import { jalaliDateKey, toGregorian, isFriday, type JalaliDate } from './jalali'

/** Raw shape of a year file fetched from time.ir (see timeIrHolidays.ts). */
export interface RawHolidayDay {
  date: string // 'YYYY-MM-DD' Jalali
  is_holiday: boolean
  events: { description: string; is_holiday: boolean }[]
}

export type HolidayYearData = Map<string, RawHolidayDay>

/** Strips a trailing bracketed annotation such as " [ 21 March ]" or " [ ١ شوال ]" from a title. */
export function sanitizeTitle(title: string): string {
  return title.replace(/\s*\[[^\]]*\]\s*$/u, '').trim()
}

export function parseYearData(json: unknown): HolidayYearData {
  if (!Array.isArray(json)) throw new Error('holiday data: expected an array')
  const map: HolidayYearData = new Map()
  for (const entry of json) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as RawHolidayDay).date !== 'string' ||
      !Array.isArray((entry as RawHolidayDay).events)
    ) {
      throw new Error('holiday data: malformed entry')
    }
    const day = entry as RawHolidayDay
    map.set(day.date, day)
  }
  return map
}

// Fixed-date holidays used only for years that have no published data file yet.
// This list is deliberately small: it only covers occasions whose Jalali date
// never moves. No other holiday is calculated by the app.
const FIXED_HOLIDAYS: { jm: number; jd: number; title: string }[] = [
  { jm: 1, jd: 1, title: 'جشن نوروز' },
  { jm: 1, jd: 2, title: 'عید نوروز' },
  { jm: 1, jd: 3, title: 'عید نوروز' },
  { jm: 1, jd: 4, title: 'عید نوروز' },
  { jm: 1, jd: 12, title: 'روز جمهوری اسلامی' },
  { jm: 1, jd: 13, title: 'جشن سیزده‌به‌در' },
  { jm: 3, jd: 14, title: 'رحلت امام خمینی' },
  { jm: 3, jd: 15, title: 'قیام ۱۵ خرداد' },
  { jm: 11, jd: 22, title: 'پیروزی انقلاب اسلامی' },
  { jm: 12, jd: 29, title: 'روز ملی شدن صنعت نفت' }
]

export interface HolidaySource {
  /** Loaded year data, keyed by 4-digit Jalali year string, e.g. "1405". */
  getYear(jy: number): HolidayYearData | undefined
}

/**
 * Look up a single day's holiday/occasion info.
 * Order of truth: the loaded year file (cache, then bundled) > the small fixed list.
 * Fridays are always a holiday regardless of source.
 */
export function getDayInfo(date: JalaliDate, source: HolidaySource): DayInfo {
  const friday = isFriday(toGregorian(date.jy, date.jm, date.jd))
  const yearData = source.getYear(date.jy)

  if (yearData) {
    const raw = yearData.get(jalaliDateKey(date))
    const events: HolidayEvent[] = (raw?.events ?? []).map((e) => ({
      title: sanitizeTitle(e.description),
      isHoliday: e.is_holiday
    }))
    return {
      isHoliday: friday || !!raw?.is_holiday,
      events
    }
  }

  // Fall back to the small fixed list; this year's data hasn't been published.
  const fixed = FIXED_HOLIDAYS.filter((h) => h.jm === date.jm && h.jd === date.jd)
  return {
    isHoliday: friday || fixed.length > 0,
    events: fixed.map((h) => ({ title: h.title, isHoliday: true })),
    incomplete: true
  }
}

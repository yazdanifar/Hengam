// Jalali (Persian/Shamsi) calendar helpers.
// The whole app stores time as epoch milliseconds and only converts to
// Jalali for display and for date-math (month length, week boundaries).
import jalaali from 'jalaali-js'

export interface JalaliDate {
  jy: number
  jm: number // 1-12
  jd: number // 1-31
}

export const WEEKDAY_LABELS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] as const
export const WEEKDAY_NAMES = [
  'شنبه',
  'یک‌شنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه'
] as const
export const MONTH_NAMES = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند'
] as const

/** Convert a JS Date (local time) to its Jalali calendar date. */
export function toJalali(date: Date): JalaliDate {
  const { jy, jm, jd } = jalaali.toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate())
  return { jy, jm, jd }
}

/** Convert a Jalali date to a JS Date at local midnight. */
export function toGregorian(jy: number, jm: number, jd: number): Date {
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd)
  return new Date(gy, gm - 1, gd)
}

/** Number of days in the given Jalali month (handles the Esfand leap day). */
export function monthLength(jy: number, jm: number): number {
  return jalaali.jalaaliMonthLength(jy, jm)
}

/** JS getDay() convention: 0=Sunday..6=Saturday. Jalali week index: 0=Saturday..6=Friday. */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 1) % 7
}

/** The Saturday on or before `date`, at local midnight. */
export function startOfJalaliWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - weekdayIndex(d))
  return d
}

/** 6x7 grid of Jalali dates covering the month, starting on Saturday. */
export function monthMatrix(jy: number, jm: number): JalaliDate[] {
  const first = toGregorian(jy, jm, 1)
  const gridStart = startOfJalaliWeek(first)
  const cells: JalaliDate[] = []
  const cur = new Date(gridStart)
  for (let i = 0; i < 42; i++) {
    cells.push(toJalali(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return cells
}

/** Is this JS Date a Friday (the fixed weekly holiday)? */
export function isFriday(date: Date): boolean {
  return date.getDay() === 5
}

/** Clamp a Jalali day-of-month to the last valid day of that month (for the 31st-in-a-30-day-month case). */
export function clampDay(jy: number, jm: number, jd: number): number {
  return Math.min(jd, monthLength(jy, jm))
}

/** Add `months` Jalali months to a date, clamping the day. */
export function addJalaliMonths(jy: number, jm: number, jd: number, months: number): JalaliDate {
  let totalMonths = (jy * 12 + (jm - 1)) + months
  const ny = Math.floor(totalMonths / 12)
  const nm = (totalMonths % 12) + 1
  return { jy: ny, jm: nm, jd: clampDay(ny, nm, jd) }
}

export function sameJalaliDate(a: JalaliDate, b: JalaliDate): boolean {
  return a.jy === b.jy && a.jm === b.jm && a.jd === b.jd
}

export function jalaliDateKey(d: JalaliDate): string {
  return `${d.jy}-${String(d.jm).padStart(2, '0')}-${String(d.jd).padStart(2, '0')}`
}

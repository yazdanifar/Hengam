// Persian date/time formatting for sync status ("last synced"). Kept out of format.ts,
// which is deliberately a dependency-free leaf; this needs jalali.ts. Both functions take
// `now` explicitly so they stay pure and testable, consistent with the Clock port.
import { toFaDigits, formatTimeFromDate } from './format'
import { MONTH_NAMES, toJalali, sameJalaliDate } from './jalali'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** "امروز ۱۴:۳۲" / "دیروز ۰۹:۱۰" / "۲ مهر ۱۴۰۴ ساعت ۱۸:۰۵" */
export function formatJalaliDateTime(ts: number, now: number): string {
  const date = new Date(ts)
  const nowDate = new Date(now)
  const time = formatTimeFromDate(date)
  const j = toJalali(date)
  const today = toJalali(nowDate)
  if (sameJalaliDate(j, today)) return `امروز ${time}`
  const yesterday = toJalali(new Date(now - DAY_MS))
  if (sameJalaliDate(j, yesterday)) return `دیروز ${time}`
  return `${toFaDigits(j.jd)} ${MONTH_NAMES[j.jm - 1]} ${toFaDigits(j.jy)} ساعت ${time}`
}

/** "لحظاتی پیش" / "۵ دقیقه پیش" / "۲ ساعت پیش", falling back to formatJalaliDateTime beyond 24h. */
export function formatRelativeFa(ts: number, now: number): string {
  const diff = now - ts
  if (diff < MINUTE_MS) return 'لحظاتی پیش'
  if (diff < HOUR_MS) return `${toFaDigits(Math.floor(diff / MINUTE_MS))} دقیقه پیش`
  if (diff < DAY_MS) return `${toFaDigits(Math.floor(diff / HOUR_MS))} ساعت پیش`
  return formatJalaliDateTime(ts, now)
}

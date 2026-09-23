const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']
const EN_TO_FA: Record<string, string> = Object.fromEntries(FA_DIGITS.map((d, i) => [String(i), d]))
const FA_TO_EN: Record<string, string> = Object.fromEntries(FA_DIGITS.map((d, i) => [d, String(i)]))
// Arabic-Indic digits (arabext), also commonly typed/pasted by users.
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
const AR_TO_EN: Record<string, string> = Object.fromEntries(AR_DIGITS.map((d, i) => [d, String(i)]))

/** Convert any string/number to Persian digits (۰-۹). Non-digit characters pass through. */
export function toFaDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (c) => EN_TO_FA[c])
}

/** Parse a string that may contain Persian, Arabic-Indic, or Latin digits into a normal number. */
export function parseDigits(value: string): number {
  const normalized = value.replace(/[۰-۹]/g, (c) => FA_TO_EN[c]).replace(/[٠-٩]/g, (c) => AR_TO_EN[c])
  return Number(normalized)
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Format minutes-of-day-based hour/minute as "HH:MM" with Persian digits. */
export function formatTime(hour: number, minute: number): string {
  return toFaDigits(`${pad2(hour)}:${pad2(minute)}`)
}

export function formatTimeFromDate(date: Date): string {
  return formatTime(date.getHours(), date.getMinutes())
}

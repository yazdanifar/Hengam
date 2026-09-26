// Helpers for an event's list of reminders, each stored as minutes-before-start (the
// same unit Google Calendar's API uses), but edited/displayed as a value + unit pair
// (minutes/hours/days/weeks), matching Google Calendar's own notification picker.
import { toFaDigits } from './format'

export type ReminderUnit = 'm' | 'h' | 'd' | 'w'

/** Minutes per unit. */
export const REMINDER_UNITS: Record<ReminderUnit, number> = { m: 1, h: 60, d: 1440, w: 10080 }

export const REMINDER_UNIT_LABELS: Record<ReminderUnit, string> = {
  m: 'دقیقه',
  h: 'ساعت',
  d: 'روز',
  w: 'هفته'
}

/** Google Calendar's own limits: at most 5 reminders per event, none more than 4 weeks out. */
export const MAX_REMINDERS = 5
export const MAX_REMINDER_MIN = 4 * REMINDER_UNITS.w

export function toMinutes(value: number, unit: ReminderUnit): number {
  return value * REMINDER_UNITS[unit]
}

/** Splits a minutes offset back into a value + the largest unit that divides it evenly,
 *  so 120 shows as "2 hours" but 90 stays "90 minutes". */
export function splitMinutes(minutes: number): { value: number; unit: ReminderUnit } {
  // 0 divides every unit evenly; "0 minutes" (at start time) is the natural reading.
  if (minutes === 0) return { value: 0, unit: 'm' }
  const units: ReminderUnit[] = ['w', 'd', 'h', 'm']
  for (const unit of units) {
    const size = REMINDER_UNITS[unit]
    if (minutes % size === 0) return { value: minutes / size, unit }
  }
  return { value: minutes, unit: 'm' }
}

/** Sorted ascending, de-duplicated, with out-of-range/invalid values dropped, and capped
 *  to Google's 5-reminder limit. */
export function normalizeReminders(list: number[]): number[] {
  const valid = list.filter((m) => Number.isInteger(m) && m >= 0 && m <= MAX_REMINDER_MIN)
  return Array.from(new Set(valid))
    .sort((a, b) => a - b)
    .slice(0, MAX_REMINDERS)
}

/** e.g. "۲ ساعت دیگر" — the lead-time text shown in the notification body. */
export function formatReminderLead(minutes: number): string {
  if (minutes <= 0) return 'همین حالا'
  const { value, unit } = splitMinutes(minutes)
  return `${toFaDigits(value)} ${REMINDER_UNIT_LABELS[unit]} دیگر`
}

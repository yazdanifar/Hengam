import { describe, expect, it } from 'vitest'
import {
  formatReminderLead,
  normalizeReminders,
  splitMinutes,
  toMinutes,
  MAX_REMINDER_MIN,
  MAX_REMINDERS
} from '@shared/reminders'

describe('toMinutes', () => {
  it('multiplies the value by the unit size', () => {
    expect(toMinutes(10, 'm')).toBe(10)
    expect(toMinutes(2, 'h')).toBe(120)
    expect(toMinutes(1, 'd')).toBe(1440)
    expect(toMinutes(1, 'w')).toBe(10080)
  })
})

describe('splitMinutes', () => {
  it('shows 0 (at start time) as 0 minutes, not 0 weeks', () => {
    expect(splitMinutes(0)).toEqual({ value: 0, unit: 'm' })
  })

  it('picks the largest unit that divides evenly', () => {
    expect(splitMinutes(120)).toEqual({ value: 2, unit: 'h' })
    expect(splitMinutes(1440)).toEqual({ value: 1, unit: 'd' })
    expect(splitMinutes(10080)).toEqual({ value: 1, unit: 'w' })
  })

  it('falls back to minutes when nothing bigger divides evenly', () => {
    expect(splitMinutes(90)).toEqual({ value: 90, unit: 'm' })
  })
})

describe('normalizeReminders', () => {
  it('sorts ascending and removes duplicates', () => {
    expect(normalizeReminders([60, 10, 10, 5])).toEqual([5, 10, 60])
  })

  it('drops invalid (negative, non-integer, out-of-range) values', () => {
    expect(normalizeReminders([-5, 1.5, MAX_REMINDER_MIN + 1, 10])).toEqual([10])
  })

  it('caps the list at MAX_REMINDERS', () => {
    const many = Array.from({ length: MAX_REMINDERS + 3 }, (_, i) => i + 1)
    expect(normalizeReminders(many)).toHaveLength(MAX_REMINDERS)
  })
})

describe('formatReminderLead', () => {
  it('renders minutes with a Persian digit and unit label', () => {
    expect(formatReminderLead(10)).toBe('۱۰ دقیقه دیگر')
  })

  it('renders larger offsets in their natural unit', () => {
    expect(formatReminderLead(120)).toBe('۲ ساعت دیگر')
    expect(formatReminderLead(1440)).toBe('۱ روز دیگر')
  })

  it('renders 0 (at start time) as "now"', () => {
    expect(formatReminderLead(0)).toBe('همین حالا')
  })
})

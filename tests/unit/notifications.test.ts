import { describe, expect, it } from 'vitest'
import {
  ALERT_TITLES,
  DEFAULT_ALERT_SETTINGS,
  MAX_ALERT_MIN,
  MIN_ALERT_MIN,
  alertBody,
  formatDurationFa,
  isActiveAlert,
  isAlertKind,
  maxAlertValue,
  normalizeAlertMinutes,
  splitAlertMinutes,
  type AppNotification
} from '@shared/notifications'

const HOUR = 3_600_000
const n = (patch: Partial<AppNotification>): AppNotification => ({ id: 1, kind: 'reminder', createdAt: 0, title: '', ...patch })

describe('alert kinds', () => {
  it('treats everything but reminders as alerts', () => {
    expect(isAlertKind('reminder')).toBe(false)
    expect(isAlertKind('sync_failure')).toBe(true)
    expect(isAlertKind('holiday_failure')).toBe(true)
  })

  it('an alert is active until resolved; a reminder never is', () => {
    expect(isActiveAlert(n({ kind: 'sync_failure' }))).toBe(true)
    expect(isActiveAlert(n({ kind: 'sync_failure', resolvedAt: 5 }))).toBe(false)
    expect(isActiveAlert(n({ kind: 'reminder' }))).toBe(false)
  })
})

describe('normalizeAlertMinutes', () => {
  it('keeps whole in-range values, rounds fractions, and clamps to [1 hour, 30 days]', () => {
    expect(normalizeAlertMinutes(720, 1)).toBe(720)
    expect(normalizeAlertMinutes(90.4, 1)).toBe(90)
    expect(normalizeAlertMinutes(5, 1)).toBe(MIN_ALERT_MIN)
    expect(normalizeAlertMinutes(10 ** 9, 1)).toBe(MAX_ALERT_MIN)
  })

  it('falls back for anything that is not a finite number', () => {
    expect(normalizeAlertMinutes(undefined, 42)).toBe(42)
    expect(normalizeAlertMinutes('720', 42)).toBe(42)
    expect(normalizeAlertMinutes(NaN, 42)).toBe(42)
    expect(normalizeAlertMinutes(Infinity, 42)).toBe(42)
  })

  it('has defaults inside the allowed range', () => {
    for (const v of Object.values(DEFAULT_ALERT_SETTINGS)) {
      expect(normalizeAlertMinutes(v, -1)).toBe(v)
    }
  })
})

describe('splitAlertMinutes / maxAlertValue', () => {
  it('shows whole days as days and everything else as hours', () => {
    expect(splitAlertMinutes(2880)).toEqual({ value: 2, unit: 'd' })
    expect(splitAlertMinutes(720)).toEqual({ value: 12, unit: 'h' })
    expect(splitAlertMinutes(90)).toEqual({ value: 2, unit: 'h' })
    expect(splitAlertMinutes(10)).toEqual({ value: 1, unit: 'h' })
  })

  it('caps each unit at 30 days', () => {
    expect(maxAlertValue('h')).toBe(720)
    expect(maxAlertValue('d')).toBe(30)
  })
})

describe('formatDurationFa', () => {
  it('picks minutes, hours or days, never saying zero', () => {
    expect(formatDurationFa(0)).toBe('۱ دقیقه')
    expect(formatDurationFa(-5)).toBe('۱ دقیقه')
    expect(formatDurationFa(20 * 60_000)).toBe('۲۰ دقیقه')
    expect(formatDurationFa(14 * HOUR + 59 * 60_000)).toBe('۱۴ ساعت')
    expect(formatDurationFa(3 * 24 * HOUR + 5 * HOUR)).toBe('۳ روز')
  })
})

describe('alert copy', () => {
  it('titles each kind and explains how long it has been failing', () => {
    expect(ALERT_TITLES.sync_failure).toMatch(/گوگل/)
    expect(ALERT_TITLES.holiday_failure).toMatch(/تعطیلات/)
    expect(alertBody('sync_failure', 0, 14 * HOUR)).toBe('از ۱۴ ساعت پیش هیچ همگام‌سازی موفقی انجام نشده است.')
    expect(alertBody('holiday_failure', 0, 72 * HOUR)).toMatch(/^از ۳ روز پیش فهرست تعطیلات از time\.ir دریافت نشده است/)
  })
})

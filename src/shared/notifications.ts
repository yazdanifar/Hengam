// The in-app notification inbox (the header bell) and the failure-alert thresholds.
// Main stores and raises notifications. Alerts carry only a kind and timestamps; their
// copy lives here so the OS notification (main) and the bell (renderer) say the same thing.
import { toFaDigits } from './format'

export type AlertKind = 'sync_failure' | 'holiday_failure'
export type NotificationKind = 'reminder' | AlertKind

export interface AppNotification {
  id: number
  kind: NotificationKind
  createdAt: number
  readAt?: number
  /** Alerts only: when the underlying problem cleared. An unresolved alert is "active". */
  resolvedAt?: number
  /** Reminders: the event title. Alerts: empty (the renderer writes the copy). */
  title: string
  /** Reminders: "۱۰:۳۰ — ۱۰ دقیقه دیگر". */
  body?: string
  /** Reminders: the occurrence's start, so a click can jump to that day. */
  eventStartTs?: number
  /** Alerts: when the failure episode began. */
  failingSince?: number
}

export function isAlertKind(kind: NotificationKind): kind is AlertKind {
  return kind !== 'reminder'
}

export function isActiveAlert(n: AppNotification): boolean {
  return isAlertKind(n.kind) && n.resolvedAt === undefined
}

/** How long each background job may keep failing before the bell raises an alert, in minutes. */
export interface AlertSettings {
  syncFailureMin: number
  holidayFailureMin: number
}

export type AlertUnit = 'h' | 'd'

export const ALERT_UNIT_MINUTES: Record<AlertUnit, number> = { h: 60, d: 1440 }
export const ALERT_UNIT_LABELS: Record<AlertUnit, string> = { h: 'ساعت', d: 'روز' }

// Sync runs every 5 minutes, so half a day of failures is a real outage; the holiday
// list only changes a few times a year, so a few days' failures is still harmless.
export const DEFAULT_ALERT_SETTINGS: AlertSettings = { syncFailureMin: 12 * 60, holidayFailureMin: 3 * 1440 }
export const MIN_ALERT_MIN = 60
export const MAX_ALERT_MIN = 30 * 1440

/** Whole minutes clamped to [1 hour, 30 days]; anything unusable becomes `fallback`. */
export function normalizeAlertMinutes(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_ALERT_MIN, Math.max(MIN_ALERT_MIN, Math.round(value)))
}

/** For editing as value + unit: 2880 → 2 days, 720 → 12 hours; a part-hour rounds to the nearest hour. */
export function splitAlertMinutes(minutes: number): { value: number; unit: AlertUnit } {
  if (minutes % ALERT_UNIT_MINUTES.d === 0) return { value: minutes / ALERT_UNIT_MINUTES.d, unit: 'd' }
  return { value: Math.max(1, Math.round(minutes / ALERT_UNIT_MINUTES.h)), unit: 'h' }
}

/** The largest value each unit accepts, so the setting never exceeds MAX_ALERT_MIN. */
export function maxAlertValue(unit: AlertUnit): number {
  return MAX_ALERT_MIN / ALERT_UNIT_MINUTES[unit]
}

/** "۱۴ ساعت" / "۳ روز" / "۲۰ دقیقه" — how long something has been going on. */
export function formatDurationFa(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) return `${toFaDigits(Math.max(1, minutes))} دقیقه`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${toFaDigits(hours)} ساعت`
  return `${toFaDigits(Math.floor(hours / 24))} روز`
}

export const ALERT_TITLES: Record<AlertKind, string> = {
  sync_failure: 'همگام‌سازی با تقویم گوگل ناموفق است',
  holiday_failure: 'به‌روزرسانی تعطیلات رسمی ناموفق است'
}

/** The alert's explanation, e.g. "از ۱۴ ساعت پیش هیچ همگام‌سازی موفقی انجام نشده است." */
export function alertBody(kind: AlertKind, failingSince: number, now: number): string {
  const since = formatDurationFa(now - failingSince)
  return kind === 'sync_failure'
    ? `از ${since} پیش هیچ همگام‌سازی موفقی انجام نشده است.`
    : `از ${since} پیش فهرست تعطیلات از time.ir دریافت نشده است؛ فهرست فعلی ممکن است قدیمی باشد.`
}

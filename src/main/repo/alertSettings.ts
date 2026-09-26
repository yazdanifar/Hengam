import { DEFAULT_ALERT_SETTINGS, normalizeAlertMinutes, type AlertSettings } from '@shared/notifications'
import type { MetaRepo } from './meta'

const KEYS: Record<keyof AlertSettings, string> = {
  syncFailureMin: 'alerts.syncFailureMin',
  holidayFailureMin: 'alerts.holidayFailureMin'
}

/** The user's failure-alert thresholds, stored in meta and always read back normalized. */
export class AlertSettingsRepo {
  constructor(private meta: MetaRepo) {}

  get(): AlertSettings {
    return {
      syncFailureMin: normalizeAlertMinutes(this.meta.getNumber(KEYS.syncFailureMin), DEFAULT_ALERT_SETTINGS.syncFailureMin),
      holidayFailureMin: normalizeAlertMinutes(
        this.meta.getNumber(KEYS.holidayFailureMin),
        DEFAULT_ALERT_SETTINGS.holidayFailureMin
      )
    }
  }

  /** Applies the valid fields of `patch` (invalid ones keep their current value); returns the result. */
  set(patch: Partial<AlertSettings>): AlertSettings {
    const current = this.get()
    for (const key of Object.keys(KEYS) as (keyof AlertSettings)[]) {
      if (patch[key] === undefined) continue
      this.meta.setNumber(KEYS[key], normalizeAlertMinutes(patch[key], current[key]))
    }
    return this.get()
  }
}

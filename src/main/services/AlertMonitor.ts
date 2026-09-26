import { ALERT_TITLES, alertBody, type AlertKind, type AlertSettings } from '@shared/notifications'
import type { SettingsSection } from '@shared/events'
import type { Clock, Notifier } from '../ports'
import type { NotificationCenter } from './NotificationCenter'

const CHECK_INTERVAL_MS = 60_000

const THRESHOLD_KEY: Record<AlertKind, keyof AlertSettings> = {
  sync_failure: 'syncFailureMin',
  holiday_failure: 'holidayFailureMin'
}

const SETTINGS_SECTION: Record<AlertKind, SettingsSection> = {
  sync_failure: 'google',
  holiday_failure: 'holidays'
}

/** For each background job: when its current failure episode began, or undefined while healthy. */
export type FailureSources = Record<AlertKind, () => number | undefined>

/**
 * Turns a long-running failure into one inbox alert (plus one OS notification) once it
 * has lasted the user's threshold, and resolves that alert as soon as the job recovers.
 * Runs on a one-minute timer, and on demand whenever a job's status changes.
 */
export class AlertMonitor {
  private timer: unknown

  constructor(
    private clock: Clock,
    private center: NotificationCenter,
    private settings: { get(): AlertSettings },
    private sources: FailureSources,
    private notifier: Notifier,
    private onOpenSettings: (section: SettingsSection) => void
  ) {}

  start(): void {
    this.evaluate()
    this.armTimer()
  }

  stop(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
  }

  private armTimer(): void {
    this.timer = this.clock.setTimeout(() => {
      this.evaluate()
      this.armTimer()
    }, CHECK_INTERVAL_MS)
  }

  evaluate(): void {
    const settings = this.settings.get()
    for (const kind of Object.keys(this.sources) as AlertKind[]) {
      const failingSince = this.sources[kind]()
      const active = this.center.activeAlert(kind)
      // A different start time means the episode that alert described ended (the job
      // recovered in between) — close it before judging the new one.
      if (active && active.failingSince !== failingSince) this.center.resolveAlert(kind)
      if (failingSince === undefined) continue

      const now = this.clock.now()
      if (now - failingSince < settings[THRESHOLD_KEY[kind]] * 60_000) continue
      const raised = this.center.raiseAlert(kind, failingSince)
      if (raised) {
        this.notifier.show(ALERT_TITLES[kind], alertBody(kind, failingSince, now), () =>
          this.onOpenSettings(SETTINGS_SECTION[kind])
        )
      }
    }
  }
}

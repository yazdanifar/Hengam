import type { Clock, PowerEvents } from '../ports'
import { toJalali, type JalaliDate } from '@shared/jalali'
import { sameJalaliDate } from '@shared/jalali'

const HOUR_MS = 60 * 60 * 1000

/**
 * Fires `onDayChanged` whenever the Jalali calendar date changes: at local
 * midnight, on wake/unlock (a sleeping Mac can miss a setTimeout), and as an
 * hourly safety net that's a no-op unless the day actually moved.
 */
export class DayTicker {
  private today: JalaliDate
  private timer: unknown

  constructor(
    private clock: Clock,
    private power: PowerEvents,
    private onDayChanged: (day: JalaliDate) => void
  ) {
    this.today = toJalali(new Date(this.clock.now()))
  }

  start(): void {
    this.power.onResume(() => this.checkNow())
    this.power.onUnlockScreen(() => this.checkNow())
    this.armMidnightTimer()
    this.armHourlySafetyNet()
  }

  private checkNow(): void {
    const now = toJalali(new Date(this.clock.now()))
    if (!sameJalaliDate(now, this.today)) {
      this.today = now
      this.onDayChanged(now)
    }
  }

  private armMidnightTimer(): void {
    const now = new Date(this.clock.now())
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
    const delay = nextMidnight.getTime() - now.getTime()
    this.timer = this.clock.setTimeout(() => {
      this.checkNow()
      this.armMidnightTimer()
    }, delay)
  }

  private armHourlySafetyNet(): void {
    this.clock.setTimeout(() => {
      this.checkNow()
      this.armHourlySafetyNet()
    }, HOUR_MS)
  }

  stop(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
  }
}

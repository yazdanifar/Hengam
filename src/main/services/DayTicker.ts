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
  private midnightTimer: unknown
  private hourlyTimer: unknown
  private unsubResume?: () => void
  private unsubUnlock?: () => void

  constructor(
    private clock: Clock,
    private power: PowerEvents,
    private onDayChanged: (day: JalaliDate) => void
  ) {
    this.today = toJalali(new Date(this.clock.now()))
  }

  start(): void {
    this.unsubResume = this.power.onResume(() => this.checkNow())
    this.unsubUnlock = this.power.onUnlockScreen(() => this.checkNow())
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
    this.midnightTimer = this.clock.setTimeout(() => {
      this.checkNow()
      this.armMidnightTimer()
    }, delay)
  }

  private armHourlySafetyNet(): void {
    this.hourlyTimer = this.clock.setTimeout(() => {
      this.checkNow()
      this.armHourlySafetyNet()
    }, HOUR_MS)
  }

  /** Clears both timer chains and unsubscribes from power events, releasing every resource start() acquired. */
  stop(): void {
    if (this.midnightTimer !== undefined) this.clock.clearTimeout(this.midnightTimer)
    if (this.hourlyTimer !== undefined) this.clock.clearTimeout(this.hourlyTimer)
    this.unsubResume?.()
    this.unsubUnlock?.()
    this.midnightTimer = undefined
    this.hourlyTimer = undefined
    this.unsubResume = undefined
    this.unsubUnlock = undefined
  }
}

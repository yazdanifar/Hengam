import { parseYearData, type HolidaySource, type HolidayYearData } from '@shared/holidays'
import { toJalali } from '@shared/jalali'
import { HolidayFetchError } from '@shared/timeIrHolidays'
import type { HolidayErrorCode, HolidayStatus } from '@shared/events'
import type { Clock, HolidayFeed, PowerEvents, RendererBridge } from '../ports'
import type { MetaRepo } from '../repo/meta'
import fs from 'node:fs'
import path from 'node:path'

/** A successful refresh is repeated this often. */
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
/** The first retry after a failure; each further consecutive failure doubles it. */
export const RETRY_BASE_MS = 60_000

/** Delay before the next attempt after `failures` consecutive failures: 1m, 2m, 4m, …,
 *  capped at one refresh interval so a failing fetch is still retried at least daily. */
export function retryDelayMs(failures: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** (failures - 1), REFRESH_INTERVAL_MS)
}

// Persisted in meta so the schedule (and the backoff) survives restarts.
const KEYS = {
  lastSuccessAt: 'holidays.lastSuccessAt',
  lastAttemptAt: 'holidays.lastAttemptAt',
  failingSince: 'holidays.failingSince',
  failures: 'holidays.consecutiveFailures',
  errorCode: 'holidays.lastErrorCode'
}

/**
 * Loads holiday year data with this priority: cached file in userData > bundled file
 * shipped with the app > nothing (holidays.ts's fixed list fallback then applies).
 *
 * Once started, refreshes the current and next Jalali year from the feed once a day,
 * retrying failures with a capped exponential backoff, and re-checking on wake/unlock
 * since a sleeping Mac can miss a timer. A failed refresh never clears existing data.
 * Pushes 'holidays:status' on every state change and 'holidays:changed' when the
 * data on disk actually changed.
 */
export class HolidayService implements HolidaySource {
  private cache = new Map<number, HolidayYearData>()
  private timer: unknown
  private unsubResume?: () => void
  private unsubUnlock?: () => void
  private running: Promise<HolidayStatus> | null = null
  private started = false

  constructor(
    private clock: Clock,
    private feed: HolidayFeed,
    private dataDir: string,
    private bundledDir: string,
    private meta: MetaRepo,
    private power: PowerEvents,
    private bridge: RendererBridge
  ) {}

  private cachePath(jy: number): string {
    return path.join(this.dataDir, 'holidays', `${jy}.json`)
  }

  private readRaw(jy: number): unknown {
    for (const p of [this.cachePath(jy), path.join(this.bundledDir, `${jy}.json`)]) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'))
      } catch {
        // try next source
      }
    }
    return undefined
  }

  getYear(jy: number): HolidayYearData | undefined {
    if (this.cache.has(jy)) return this.cache.get(jy)
    const raw = this.readRaw(jy)
    if (raw === undefined) return undefined
    try {
      const loaded = parseYearData(raw)
      this.cache.set(jy, loaded)
      return loaded
    } catch {
      return undefined
    }
  }

  getStatus(): HolidayStatus {
    const failingSince = this.meta.getNumber(KEYS.failingSince)
    return {
      phase: this.running ? 'refreshing' : failingSince !== undefined ? 'error' : 'idle',
      lastSuccessAt: this.meta.getNumber(KEYS.lastSuccessAt),
      failingSince,
      nextAttemptAt: this.started ? this.nextDueAt() : undefined,
      errorCode: this.meta.get(KEYS.errorCode) as HolidayErrorCode | undefined
    }
  }

  start(): void {
    this.started = true
    this.unsubResume = this.power.onResume(() => this.runIfDue())
    this.unsubUnlock = this.power.onUnlockScreen(() => this.runIfDue())
    this.runIfDue()
  }

  stop(): void {
    this.started = false
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
    this.unsubResume?.()
    this.unsubUnlock?.()
    this.unsubResume = undefined
    this.unsubUnlock = undefined
  }

  /** Refreshes now, regardless of the schedule; joins a refresh already in flight. */
  refreshNow(): Promise<HolidayStatus> {
    if (this.running) return this.running
    this.running = this.runOnce().then(() => {
      this.running = null
      if (this.started) this.armTimer()
      return this.pushStatus()
    })
    this.pushStatus()
    return this.running
  }

  private nextDueAt(): number {
    const failures = this.meta.getNumber(KEYS.failures) ?? 0
    const lastAttemptAt = this.meta.getNumber(KEYS.lastAttemptAt)
    if (failures > 0 && lastAttemptAt !== undefined) return lastAttemptAt + retryDelayMs(failures)
    const lastSuccessAt = this.meta.getNumber(KEYS.lastSuccessAt)
    return lastSuccessAt === undefined ? this.clock.now() : lastSuccessAt + REFRESH_INTERVAL_MS
  }

  // Only reachable while started: stop() clears the timer and the wake listeners.
  private runIfDue(): void {
    if (this.running) return
    if (this.clock.now() >= this.nextDueAt()) void this.refreshNow()
    else this.armTimer()
  }

  private armTimer(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = this.clock.setTimeout(
      () => {
        this.timer = undefined
        this.runIfDue()
      },
      Math.max(0, this.nextDueAt() - this.clock.now())
    )
  }

  private pushStatus(): HolidayStatus {
    const status = this.getStatus()
    this.bridge.send('holidays:status', status)
    return status
  }

  private async runOnce(): Promise<void> {
    const startedAt = this.clock.now()
    this.meta.setNumber(KEYS.lastAttemptAt, startedAt)
    const currentJy = toJalali(new Date(startedAt)).jy
    let changed = false
    try {
      changed = await this.fetchAndStore(currentJy)
      // Next year is best-effort: the current year is what the app shows today, so a
      // next-year failure alone doesn't count as a failed refresh.
      try {
        changed = (await this.fetchAndStore(currentJy + 1)) || changed
      } catch (err) {
        console.warn(`[holidays] fetching ${currentJy + 1} failed; keeping the existing copy`, err)
      }
      this.meta.setNumber(KEYS.lastSuccessAt, this.clock.now())
      this.meta.delete(KEYS.failingSince)
      this.meta.delete(KEYS.failures)
      this.meta.delete(KEYS.errorCode)
    } catch (err) {
      console.error('[holidays] refresh failed', err)
      if (this.meta.getNumber(KEYS.failingSince) === undefined) this.meta.setNumber(KEYS.failingSince, startedAt)
      this.meta.setNumber(KEYS.failures, (this.meta.getNumber(KEYS.failures) ?? 0) + 1)
      this.meta.set(KEYS.errorCode, err instanceof HolidayFetchError ? err.code : 'unknown')
    }
    if (changed) this.bridge.send('holidays:changed', { changedAt: this.clock.now() })
  }

  /** Fetches, validates and caches one year; returns whether it differs from what we had. */
  private async fetchAndStore(jy: number): Promise<boolean> {
    const raw = await this.feed.fetchYear(jy)
    let parsed: HolidayYearData
    try {
      parsed = parseYearData(raw)
    } catch (err) {
      throw new HolidayFetchError('invalid_data', `holidays ${jy}: ${(err as Error).message}`)
    }
    const json = JSON.stringify(raw)
    const previous = this.readRaw(jy)
    fs.mkdirSync(path.dirname(this.cachePath(jy)), { recursive: true })
    fs.writeFileSync(this.cachePath(jy), json)
    this.cache.set(jy, parsed)
    return previous === undefined || JSON.stringify(previous) !== json
  }
}

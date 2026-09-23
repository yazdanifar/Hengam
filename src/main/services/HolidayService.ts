import { parseYearData, type HolidaySource, type HolidayYearData } from '@shared/holidays'
import type { Clock, HolidayFeed } from '../ports'
import fs from 'node:fs'
import path from 'node:path'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Loads holiday year data with this priority: cached file in userData >
 * bundled file shipped with the app > nothing (holidays.ts's fixed list
 * fallback then applies). Refreshes the cache from the network at most
 * once every 7 days, and silently keeps the old cache on any failure.
 */
export class HolidayService implements HolidaySource {
  private cache = new Map<number, HolidayYearData>()

  constructor(
    private clock: Clock,
    private feed: HolidayFeed,
    private dataDir: string,
    private bundledDir: string
  ) {}

  private cachePath(jy: number): string {
    return path.join(this.dataDir, 'holidays', `${jy}.json`)
  }

  private lastCheckPath(): string {
    return path.join(this.dataDir, 'holidays', '.last-check')
  }

  private loadFromDisk(jy: number): HolidayYearData | undefined {
    for (const dir of [path.dirname(this.cachePath(jy)), this.bundledDir]) {
      const p = path.join(dir, `${jy}.json`)
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
        return parseYearData(raw)
      } catch {
        // try next source
      }
    }
    return undefined
  }

  getYear(jy: number): HolidayYearData | undefined {
    if (this.cache.has(jy)) return this.cache.get(jy)
    const loaded = this.loadFromDisk(jy)
    if (loaded) this.cache.set(jy, loaded)
    return loaded
  }

  private shouldRefresh(): boolean {
    try {
      const last = Number(fs.readFileSync(this.lastCheckPath(), 'utf-8'))
      return this.clock.now() - last > WEEK_MS
    } catch {
      return true
    }
  }

  /** Fetches the current and next Jalali year if the weekly throttle allows it. Never throws. */
  async refreshIfDue(currentJy: number): Promise<void> {
    if (!this.shouldRefresh()) return
    for (const jy of [currentJy, currentJy + 1]) {
      try {
        const raw = await this.feed.fetchYear(jy)
        const parsed = parseYearData(raw) // validates shape; throws on malformed data
        fs.mkdirSync(path.dirname(this.cachePath(jy)), { recursive: true })
        fs.writeFileSync(this.cachePath(jy), JSON.stringify(raw))
        this.cache.set(jy, parsed)
      } catch {
        // keep whatever we already have (disk cache or bundled copy)
      }
    }
    try {
      fs.mkdirSync(path.dirname(this.lastCheckPath()), { recursive: true })
      fs.writeFileSync(this.lastCheckPath(), String(this.clock.now()))
    } catch {
      // non-fatal
    }
  }
}

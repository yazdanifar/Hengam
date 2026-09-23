import { describe, expect, it } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { FakeClock } from '../support/fakes/FakeClock'
import { HolidayService } from '@main/services/HolidayService'
import type { HolidayFeed } from '@main/ports'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hengam-holidays-'))
}

const bundledDir = path.resolve(__dirname, '../../src/shared/data/holidays')

class StubFeed implements HolidayFeed {
  fail = false
  malformed = false
  data: Record<number, unknown> = {}
  async fetchYear(jy: number): Promise<unknown> {
    if (this.fail) throw new Error('network down')
    if (this.malformed) return { not: 'an array' }
    return this.data[jy] ?? [{ date: `${jy}-01-01`, is_holiday: true, events: [{ description: 'نوروز', is_holiday: true }] }]
  }
}

describe('HolidayService', () => {
  it('a fresh fetch writes the cache and getYear reads it back', async () => {
    const dataDir = tmpDir()
    const clock = new FakeClock('2026-09-22T08:00:00')
    const feed = new StubFeed()
    const svc = new HolidayService(clock, feed, dataDir, bundledDir)
    await svc.refreshIfDue(1405)
    const info = svc.getYear(1405)
    expect(info?.get('1405-01-01')?.events[0].description).toBe('نوروز')
  })

  it('a failed fetch keeps the previous cache instead of clearing it', async () => {
    const dataDir = tmpDir()
    const clock = new FakeClock('2026-09-22T08:00:00')
    const feed = new StubFeed()
    const svc = new HolidayService(clock, feed, dataDir, bundledDir)
    await svc.refreshIfDue(1405)
    expect(svc.getYear(1405)).toBeDefined()

    // force a second refresh (bypass throttle) and simulate failure
    fs.writeFileSync(path.join(dataDir, 'holidays', '.last-check'), '0')
    feed.fail = true
    const svc2 = new HolidayService(clock, feed, dataDir, bundledDir)
    await svc2.refreshIfDue(1405)
    expect(svc2.getYear(1405)).toBeDefined() // still has the cached file from before
  })

  it('malformed data is rejected and does not overwrite the cache', async () => {
    const dataDir = tmpDir()
    const clock = new FakeClock('2026-09-22T08:00:00')
    const feed = new StubFeed()
    const svc = new HolidayService(clock, feed, dataDir, bundledDir)
    await svc.refreshIfDue(1405)
    const before = fs.readFileSync(path.join(dataDir, 'holidays', '1405.json'), 'utf-8')

    fs.writeFileSync(path.join(dataDir, 'holidays', '.last-check'), '0')
    feed.malformed = true
    await svc.refreshIfDue(1405)
    const after = fs.readFileSync(path.join(dataDir, 'holidays', '1405.json'), 'utf-8')
    expect(after).toBe(before)
  })

  it('respects the 7-day throttle', async () => {
    const dataDir = tmpDir()
    const clock = new FakeClock('2026-09-22T08:00:00')
    const feed = new StubFeed()
    const svc = new HolidayService(clock, feed, dataDir, bundledDir)
    await svc.refreshIfDue(1405)
    let calls = 0
    const originalFetch = feed.fetchYear.bind(feed)
    feed.fetchYear = async (jy) => {
      calls++
      return originalFetch(jy)
    }
    clock.setNow('2026-09-23T08:00:00') // only 1 day later
    await svc.refreshIfDue(1405)
    expect(calls).toBe(0)
  })

  it('falls back to the bundled copy when nothing is cached', () => {
    const dataDir = tmpDir()
    const clock = new FakeClock('2026-09-22T08:00:00')
    const feed = new StubFeed()
    const svc = new HolidayService(clock, feed, dataDir, bundledDir)
    const info = svc.getYear(1405) // 1405.json ships bundled
    expect(info).toBeDefined()
    expect(info!.size).toBeGreaterThan(0)
  })
})

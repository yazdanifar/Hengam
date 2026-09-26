import { describe, expect, it } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { createTestDb, withRollback } from '../support/db'
import { FakeClock } from '../support/fakes/FakeClock'
import { FakePowerEvents } from '../support/fakes/FakePowerEvents'
import { SpyRendererBridge } from '../support/fakes/SpyRendererBridge'
import { HolidayService, REFRESH_INTERVAL_MS, RETRY_BASE_MS, retryDelayMs } from '@main/services/HolidayService'
import { MetaRepo } from '@main/repo/meta'
import { HolidayFetchError } from '@shared/timeIrHolidays'
import type { HolidayFeed } from '@main/ports'
import type { HolidayStatus } from '@shared/events'

const db = createTestDb()
withRollback(() => db)

const bundledDir = path.resolve(__dirname, '../../src/shared/data/holidays')
const MIN = 60_000
const HOUR = 60 * MIN
// 2026-09-24 is in Jalali 1405, so a refresh fetches 1405 (required) and 1406 (best-effort).
const START = '2026-09-24T09:00:00'

const yearData = (jy: number, tag = '') => [
  { date: `${jy}-01-01`, is_holiday: true, events: [{ description: `نوروز${tag}`, is_holiday: true }] }
]

/** Answers with `respond(jy)` (throwing = failure), recording every call and its time. */
class StubFeed implements HolidayFeed {
  calls: { jy: number; at: number }[] = []
  respond: (jy: number) => unknown | Promise<unknown> = (jy) => yearData(jy)
  constructor(private clock: FakeClock) {}
  async fetchYear(jy: number): Promise<unknown> {
    this.calls.push({ jy, at: this.clock.now() })
    return this.respond(jy)
  }
  attempts(): number {
    return this.calls.filter((c) => c.jy === 1405).length
  }
}

/** Lets the stub's promises and the service's continuations run. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function setup(opts: { dataDir?: string; clock?: FakeClock } = {}) {
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'hengam-holidays-'))
  const clock = opts.clock ?? new FakeClock(START)
  const feed = new StubFeed(clock)
  const power = new FakePowerEvents()
  const bridge = new SpyRendererBridge()
  const meta = new MetaRepo(db)
  const svc = new HolidayService(clock, feed, dataDir, bundledDir, meta, power, bridge)
  const statuses = () => bridge.sent.filter((s) => s.channel === 'holidays:status').map((s) => s.payload as HolidayStatus)
  const changedCount = () => bridge.sent.filter((s) => s.channel === 'holidays:changed').length
  /** Advances the fake clock and lets any refresh it triggered finish. */
  const advance = async (ms: number) => {
    clock.advance(ms)
    await flush()
  }
  return { dataDir, clock, feed, power, bridge, meta, svc, statuses, changedCount, advance }
}

describe('retryDelayMs', () => {
  it('doubles from one minute and never exceeds one refresh interval', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([MIN, 2 * MIN, 4 * MIN, 8 * MIN])
    expect(retryDelayMs(11)).toBe(1024 * MIN)
    expect(retryDelayMs(12)).toBe(REFRESH_INTERVAL_MS)
    expect(retryDelayMs(50)).toBe(REFRESH_INTERVAL_MS)
    expect(RETRY_BASE_MS).toBe(MIN)
  })
})

describe('HolidayService — reading data', () => {
  it('prefers the downloaded cache over the bundled copy', async () => {
    const ctx = setup()
    ctx.feed.respond = (jy) => yearData(jy, ' (fresh)')
    await ctx.svc.refreshNow()
    expect(ctx.svc.getYear(1405)?.get('1405-01-01')?.events[0].description).toBe('نوروز (fresh)')

    // A new instance (e.g. after a restart) reads the cache file, not the bundled one.
    const again = setup({ dataDir: ctx.dataDir })
    expect(again.svc.getYear(1405)?.get('1405-01-01')?.events[0].description).toBe('نوروز (fresh)')
  })

  it('falls back to the bundled copy, and to nothing for a year with no data', () => {
    const { svc } = setup()
    expect(svc.getYear(1405)!.size).toBeGreaterThan(100)
    expect(svc.getYear(1300)).toBeUndefined()
  })

  it('treats an unreadable cache file as missing', () => {
    const { svc, dataDir } = setup()
    fs.mkdirSync(path.join(dataDir, 'holidays'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'holidays', '1390.json'), JSON.stringify({ not: 'an array' }))
    expect(svc.getYear(1390)).toBeUndefined()
  })
})

describe('HolidayService — daily schedule', () => {
  it('refreshes right away on first start, then again exactly one day after each success', async () => {
    const ctx = setup()
    ctx.svc.start()
    await flush()
    expect(ctx.feed.calls.map((c) => c.jy)).toEqual([1405, 1406])
    expect(ctx.svc.getStatus()).toEqual({
      phase: 'idle',
      lastSuccessAt: ctx.clock.now(),
      failingSince: undefined,
      nextAttemptAt: ctx.clock.now() + REFRESH_INTERVAL_MS,
      errorCode: undefined
    })

    await ctx.advance(REFRESH_INTERVAL_MS - 1)
    expect(ctx.feed.attempts()).toBe(1)
    await ctx.advance(1)
    expect(ctx.feed.attempts()).toBe(2)
    ctx.svc.stop()
  })

  it('pushes refreshing then the outcome, and announces a data change only when the data differs', async () => {
    const ctx = setup()
    await ctx.svc.refreshNow()
    expect(ctx.statuses().map((s) => s.phase)).toEqual(['refreshing', 'idle'])
    expect(ctx.changedCount()).toBe(1)

    await ctx.svc.refreshNow() // same content again
    expect(ctx.changedCount()).toBe(1)

    ctx.feed.respond = (jy) => (jy === 1406 ? yearData(jy, ' (moved)') : yearData(jy))
    await ctx.svc.refreshNow() // only next year changed
    expect(ctx.changedCount()).toBe(2)
  })

  it('does not refresh on start when the last success is under a day old — it waits for the remainder', async () => {
    const first = setup()
    await first.svc.refreshNow()

    first.clock.advance(20 * HOUR)
    const restarted = setup({ dataDir: first.dataDir, clock: first.clock })
    restarted.svc.start()
    await flush()
    expect(restarted.feed.calls).toEqual([])

    await restarted.advance(4 * HOUR)
    expect(restarted.feed.attempts()).toBe(1)
    restarted.svc.stop()
  })

  it('catches up on wake or unlock when a due refresh was missed while asleep', async () => {
    const ctx = setup()
    ctx.svc.start()
    await flush()
    // A sleeping Mac doesn't fire timers: jump the clock without firing them.
    ctx.clock.setNow('2026-09-26T09:00:00')
    ctx.power.fireResume()
    await flush()
    expect(ctx.feed.attempts()).toBe(2)

    ctx.clock.setNow('2026-09-28T09:00:00')
    ctx.power.fireUnlock()
    await flush()
    expect(ctx.feed.attempts()).toBe(3)
    ctx.svc.stop()
  })

  it('ignores wake events when nothing is due, just re-arming the timer', async () => {
    const ctx = setup()
    ctx.svc.start()
    await flush()
    ctx.power.fireResume()
    await flush()
    expect(ctx.feed.attempts()).toBe(1)
    await ctx.advance(REFRESH_INTERVAL_MS)
    expect(ctx.feed.attempts()).toBe(2)
    ctx.svc.stop()
  })
})

describe('HolidayService — failures and backoff', () => {
  it('retries after 1, 2, 4 and 8 minutes, keeping the first failure time', async () => {
    const ctx = setup()
    ctx.feed.respond = () => {
      throw new HolidayFetchError('network', 'offline')
    }
    const t0 = ctx.clock.now()
    ctx.svc.start()
    await flush()
    for (const wait of [MIN, 2 * MIN, 4 * MIN, 8 * MIN]) await ctx.advance(wait)

    const at = ctx.feed.calls.filter((c) => c.jy === 1405).map((c) => (c.at - t0) / MIN)
    expect(at).toEqual([0, 1, 3, 7, 15])
    expect(ctx.svc.getStatus()).toMatchObject({
      phase: 'error',
      failingSince: t0,
      errorCode: 'network',
      nextAttemptAt: ctx.clock.now() + 16 * MIN,
      lastSuccessAt: undefined
    })
    ctx.svc.stop()
  })

  it('caps the backoff at one day, so a failing refresh is still tried daily', async () => {
    const ctx = setup()
    ctx.feed.respond = () => {
      throw new HolidayFetchError('server', 'down')
    }
    ctx.svc.start()
    await flush()
    // Retries after 1, 2, 4, …, 1024 minutes; each timer is armed only once the previous
    // attempt settles, so step through them one at a time.
    for (let failures = 1; failures <= 11; failures++) await ctx.advance(retryDelayMs(failures))
    expect(ctx.feed.attempts()).toBe(12)
    const s = ctx.svc.getStatus()
    expect(s.nextAttemptAt! - ctx.feed.calls.at(-1)!.at).toBe(REFRESH_INTERVAL_MS)
    ctx.svc.stop()
  })

  it('a success clears the failure and returns to the daily cadence', async () => {
    const ctx = setup()
    let fail = true
    ctx.feed.respond = (jy) => {
      if (fail) throw new HolidayFetchError('network', 'offline')
      return yearData(jy)
    }
    ctx.svc.start()
    await flush()
    fail = false
    await ctx.advance(MIN)
    expect(ctx.svc.getStatus()).toMatchObject({
      phase: 'idle',
      failingSince: undefined,
      errorCode: undefined,
      nextAttemptAt: ctx.clock.now() + REFRESH_INTERVAL_MS
    })

    fail = true // the next failure starts over at one minute
    await ctx.advance(REFRESH_INTERVAL_MS)
    expect(ctx.svc.getStatus().nextAttemptAt).toBe(ctx.clock.now() + MIN)
    ctx.svc.stop()
  })

  it('resumes the same backoff after a restart instead of hammering time.ir', async () => {
    const first = setup()
    first.feed.respond = () => {
      throw new HolidayFetchError('network', 'offline')
    }
    first.svc.start()
    await flush()
    await first.advance(MIN) // 2 failures: next retry in 2 minutes
    first.svc.stop()

    const restarted = setup({ dataDir: first.dataDir, clock: first.clock })
    restarted.feed.respond = first.feed.respond
    restarted.svc.start()
    await flush()
    expect(restarted.feed.calls).toEqual([])
    expect(restarted.svc.getStatus().failingSince).toBe(first.feed.calls[0].at)
    await restarted.advance(2 * MIN)
    expect(restarted.feed.attempts()).toBe(1)
    restarted.svc.stop()
  })

  it('keeps existing data and reports invalid_data when the feed returns something malformed', async () => {
    const ctx = setup()
    await ctx.svc.refreshNow()
    const cached = fs.readFileSync(path.join(ctx.dataDir, 'holidays', '1405.json'), 'utf-8')

    ctx.feed.respond = () => ({ not: 'an array' })
    const s = await ctx.svc.refreshNow()
    expect(s).toMatchObject({ phase: 'error', errorCode: 'invalid_data' })
    expect(fs.readFileSync(path.join(ctx.dataDir, 'holidays', '1405.json'), 'utf-8')).toBe(cached)
    expect(ctx.svc.getYear(1405)).toBeDefined()
  })

  it('reports unknown for unexpected errors', async () => {
    const ctx = setup()
    ctx.feed.respond = () => {
      throw new Error('boom')
    }
    expect((await ctx.svc.refreshNow()).errorCode).toBe('unknown')
  })

  it('counts a next-year failure alone as a success — today only needs the current year', async () => {
    const ctx = setup()
    ctx.feed.respond = (jy) => {
      if (jy === 1406) throw new HolidayFetchError('invalid_data', 'not published yet')
      return yearData(jy)
    }
    const s = await ctx.svc.refreshNow()
    expect(s.phase).toBe('idle')
    expect(s.lastSuccessAt).toBe(ctx.clock.now())
  })
})

describe('HolidayService — manual refresh and lifecycle', () => {
  it('joins a refresh already in flight instead of starting a second', async () => {
    const ctx = setup()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    ctx.feed.respond = async (jy) => {
      await gate
      return yearData(jy)
    }
    const a = ctx.svc.refreshNow()
    const b = ctx.svc.refreshNow()
    expect(b).toBe(a)
    expect(ctx.svc.getStatus().phase).toBe('refreshing')
    release()
    await a
    expect(ctx.feed.attempts()).toBe(1)
  })

  it('a wake event during a refresh does not start another', async () => {
    const ctx = setup()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    ctx.feed.respond = async (jy) => {
      await gate
      return yearData(jy)
    }
    ctx.svc.start()
    ctx.power.fireResume()
    release()
    await flush()
    expect(ctx.feed.attempts()).toBe(1)
    ctx.svc.stop()
  })

  it('a manual refresh before start() does not arm the schedule', async () => {
    const ctx = setup()
    const s = await ctx.svc.refreshNow()
    expect(s.nextAttemptAt).toBeUndefined()
    await ctx.advance(3 * REFRESH_INTERVAL_MS)
    expect(ctx.feed.attempts()).toBe(1)
  })

  it('a manual refresh while started reschedules from its own result', async () => {
    const ctx = setup()
    ctx.svc.start()
    await flush()
    await ctx.advance(10 * HOUR)
    await ctx.svc.refreshNow()
    await ctx.advance(REFRESH_INTERVAL_MS - 1)
    expect(ctx.feed.attempts()).toBe(2)
    await ctx.advance(1)
    expect(ctx.feed.attempts()).toBe(3)
    ctx.svc.stop()
  })

  it('stop() cancels the timer and wake listeners, and a refresh finishing afterwards does not re-arm', async () => {
    const ctx = setup()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    ctx.feed.respond = async (jy) => {
      await gate
      return yearData(jy)
    }
    ctx.svc.start()
    ctx.svc.stop()
    expect(ctx.power.listenerCount()).toBe(0)
    release()
    await flush()
    ctx.feed.respond = (jy) => yearData(jy)
    await ctx.advance(5 * REFRESH_INTERVAL_MS)
    expect(ctx.feed.attempts()).toBe(1)
    ctx.svc.stop() // idempotent
  })
})

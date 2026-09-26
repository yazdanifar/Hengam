import { describe, expect, it, vi } from 'vitest'
import { FakeClock } from '../support/fakes/FakeClock'
import { FakePowerEvents } from '../support/fakes/FakePowerEvents'
import { DayTicker } from '@main/services/DayTicker'

describe('DayTicker', () => {
  it('reports today once on start', () => {
    const clock = new FakeClock('2026-09-22T10:00:00')
    const power = new FakePowerEvents()
    const changes: string[] = []
    const ticker = new DayTicker(clock, power, (d) => changes.push(`${d.jy}-${d.jm}-${d.jd}`))
    ticker.start()
    expect(changes).toEqual(['1405-6-31'])
  })

  it('fires onDayChanged once at midnight', () => {
    const clock = new FakeClock('2026-09-22T23:59:50')
    const power = new FakePowerEvents()
    const changes: string[] = []
    const ticker = new DayTicker(clock, power, (d) => changes.push(`${d.jy}-${d.jm}-${d.jd}`))
    ticker.start()
    changes.length = 0 // ignore the initial report from start()

    clock.advance(20_000) // crosses midnight
    expect(changes).toHaveLength(1)
    expect(changes[0]).toBe('1405-7-1')
  })

  it('a resume after multi-day sleep updates the date', () => {
    const clock = new FakeClock('2026-09-22T10:00:00')
    const power = new FakePowerEvents()
    const changes: string[] = []
    const ticker = new DayTicker(clock, power, (d) => changes.push(`${d.jy}-${d.jm}-${d.jd}`))
    ticker.start()
    changes.length = 0 // ignore the initial report from start()

    clock.setNow('2026-09-25T10:00:00') // 3 days later, no timers fired
    power.fireResume()
    expect(changes).toHaveLength(1)
    expect(changes[0]).toBe('1405-7-3')
  })

  it('the hourly safety net does nothing when the day has not changed', () => {
    const clock = new FakeClock('2026-09-22T10:00:00')
    const power = new FakePowerEvents()
    const changes: string[] = []
    const ticker = new DayTicker(clock, power, (d) => changes.push(`${d.jy}-${d.jm}-${d.jd}`))
    ticker.start()
    changes.length = 0 // ignore the initial report from start()

    clock.advance(60 * 60 * 1000) // one hour later, same day
    expect(changes).toHaveLength(0)
  })

  it('stop() releases every resource start() acquired: both timer chains and both power subscriptions', () => {
    const clock = new FakeClock('2026-09-22T10:00:00')
    const power = new FakePowerEvents()
    const changes: string[] = []
    const ticker = new DayTicker(clock, power, (d) => changes.push(`${d.jy}-${d.jm}-${d.jd}`))
    ticker.start()
    changes.length = 0 // ignore the initial report from start()
    expect(power.listenerCount()).toBe(2) // resume + unlock-screen

    ticker.stop()
    expect(power.listenerCount()).toBe(0)

    // Neither the midnight timer nor the hourly safety net should still be armed.
    clock.advance(48 * 60 * 60 * 1000) // two full days, crossing midnight twice
    expect(changes).toHaveLength(0)

    // A resume/unlock after stop() must not call back into onDayChanged either.
    power.fireResume()
    power.fireUnlock()
    expect(changes).toHaveLength(0)
  })
})

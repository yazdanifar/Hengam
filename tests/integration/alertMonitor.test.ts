import { describe, expect, it } from 'vitest'
import { createTestDb, withRollback } from '../support/db'
import { FakeClock } from '../support/fakes/FakeClock'
import { SpyNotifier } from '../support/fakes/SpyNotifier'
import { SpyRendererBridge } from '../support/fakes/SpyRendererBridge'
import { NotificationsRepo } from '@main/repo/notifications'
import { NotificationCenter } from '@main/services/NotificationCenter'
import { AlertMonitor } from '@main/services/AlertMonitor'
import type { AlertSettings } from '@shared/notifications'
import type { SettingsSection } from '@shared/events'

const db = createTestDb()
withRollback(() => db)

const HOUR = 3_600_000

function setup(settings: AlertSettings = { syncFailureMin: 12 * 60, holidayFailureMin: 3 * 24 * 60 }) {
  const clock = new FakeClock('2026-09-24T09:00:00')
  const bridge = new SpyRendererBridge()
  const notifier = new SpyNotifier()
  const center = new NotificationCenter(new NotificationsRepo(db), clock, bridge)
  const failing: { sync?: number; holidays?: number } = {}
  const opened: SettingsSection[] = []
  const current = { ...settings }
  const monitor = new AlertMonitor(
    clock,
    center,
    { get: () => current },
    { sync_failure: () => failing.sync, holiday_failure: () => failing.holidays },
    notifier,
    (s) => opened.push(s)
  )
  const changes = () => bridge.sent.filter((s) => s.channel === 'notifications:changed').length
  return { clock, bridge, notifier, center, failing, opened, monitor, settings: current, changes }
}

describe('NotificationCenter', () => {
  it('records a reminder and announces the change', () => {
    const { center, changes } = setup()
    const n = center.addReminder({ title: 'جلسه', body: '۱۰:۰۰ — همین حالا', eventStartTs: 5 })
    expect(center.list()).toEqual([n])
    expect(n.createdAt).toBe(new Date('2026-09-24T09:00:00').getTime())
    expect(changes()).toBe(1)
  })

  it('only announces mutations that changed something', () => {
    const { center, changes } = setup()
    center.markAllRead()
    center.dismiss(12345)
    center.clearAll()
    center.resolveAlert('sync_failure')
    expect(changes()).toBe(0)

    const n = center.addReminder({ title: 't', body: 'b', eventStartTs: 1 })
    center.markAllRead()
    center.dismiss(n.id)
    center.addReminder({ title: 't', body: 'b', eventStartTs: 1 })
    center.clearAll()
    expect(changes()).toBe(5)
    expect(center.list()).toEqual([])
  })

  it('raises one alert per kind at a time', () => {
    const { center } = setup()
    expect(center.raiseAlert('sync_failure', 1)).toBeDefined()
    expect(center.raiseAlert('sync_failure', 1)).toBeUndefined()
    expect(center.activeAlert('sync_failure')?.failingSince).toBe(1)
  })
})

describe('AlertMonitor', () => {
  it('stays quiet while a job is healthy or has failed for less than its threshold', () => {
    const { monitor, failing, clock, center, notifier } = setup()
    monitor.start()
    failing.sync = clock.now()
    clock.advance(11 * HOUR + 59 * 60_000)
    expect(center.list()).toEqual([])
    expect(notifier.shown).toEqual([])
    monitor.stop()
  })

  it('raises one inbox alert and one OS notification once the failure reaches the threshold', () => {
    const { monitor, failing, clock, center, notifier, opened } = setup()
    failing.sync = clock.now()
    monitor.start()
    clock.advance(12 * HOUR)

    const alert = center.activeAlert('sync_failure')!
    expect(alert.failingSince).toBe(failing.sync)
    expect(notifier.shown).toEqual([
      { title: 'همگام‌سازی با تقویم گوگل ناموفق است', body: 'از ۱۲ ساعت پیش هیچ همگام‌سازی موفقی انجام نشده است.', onClick: expect.any(Function) }
    ])

    clock.advance(6 * HOUR) // still failing: no repeat
    expect(center.list()).toHaveLength(1)
    expect(notifier.shown).toHaveLength(1)

    notifier.shown[0].onClick!()
    expect(opened).toEqual(['google'])
    monitor.stop()
  })

  it('uses each job its own threshold, and sends the holiday alert to the holidays tab', () => {
    const { monitor, failing, clock, center, notifier, opened } = setup()
    failing.sync = clock.now()
    failing.holidays = clock.now()
    monitor.start()
    clock.advance(24 * HOUR)
    expect(center.activeAlert('sync_failure')).toBeDefined()
    expect(center.activeAlert('holiday_failure')).toBeUndefined()

    clock.advance(48 * HOUR)
    expect(center.activeAlert('holiday_failure')).toBeDefined()
    notifier.shown[1].onClick!()
    expect(opened).toEqual(['holidays'])
    monitor.stop()
  })

  it('resolves the alert as soon as the job recovers, and opens a fresh one for a later episode', () => {
    const { monitor, failing, clock, center } = setup()
    failing.sync = clock.now()
    monitor.evaluate()
    clock.advance(13 * HOUR)
    monitor.evaluate()
    const first = center.activeAlert('sync_failure')!

    failing.sync = undefined
    monitor.evaluate()
    expect(center.activeAlert('sync_failure')).toBeUndefined()
    expect(center.list()[0]).toMatchObject({ id: first.id, resolvedAt: clock.now() })

    failing.sync = clock.now()
    clock.advance(12 * HOUR)
    monitor.evaluate()
    expect(center.activeAlert('sync_failure')!.id).not.toBe(first.id)
  })

  it('closes a stale alert when a new episode started without an evaluation in between', () => {
    const { monitor, failing, clock, center } = setup()
    failing.sync = clock.now()
    clock.advance(13 * HOUR)
    monitor.evaluate()
    const first = center.activeAlert('sync_failure')!

    // Recovered and failed again between two checks: a new start time, not yet over the threshold.
    failing.sync = clock.now()
    monitor.evaluate()
    expect(center.activeAlert('sync_failure')).toBeUndefined()
    expect(center.list().find((n) => n.id === first.id)!.resolvedAt).toBe(clock.now())
  })

  it('applies a changed threshold on the next evaluation', () => {
    const { monitor, failing, clock, center, settings } = setup()
    failing.sync = clock.now()
    clock.advance(2 * HOUR)
    monitor.evaluate()
    expect(center.activeAlert('sync_failure')).toBeUndefined()

    settings.syncFailureMin = 60
    monitor.evaluate()
    expect(center.activeAlert('sync_failure')).toBeDefined()
  })

  it('stop() cancels the periodic check, and is safe to call twice or before start', () => {
    const { monitor, failing, clock, center } = setup()
    monitor.stop()
    monitor.start()
    monitor.stop()
    monitor.stop()
    failing.sync = clock.now() - 13 * HOUR
    clock.advance(10 * 60_000)
    expect(center.list()).toEqual([])
  })
})

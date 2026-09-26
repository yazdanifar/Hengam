// Behaviour scenarios for the background-job alerts, with the real services wired the way
// container.ts wires them: status pushes flow through an observing bridge that re-checks
// alerts, so these exercise the same event path the running app uses.
import { describe, expect, it } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { createTestDb, withRollback } from '../support/db'
import { FakeClock } from '../support/fakes/FakeClock'
import { FakePowerEvents } from '../support/fakes/FakePowerEvents'
import { SpyNotifier } from '../support/fakes/SpyNotifier'
import { SpyRendererBridge } from '../support/fakes/SpyRendererBridge'
import { EventsRepo } from '@main/repo/events'
import { MetaRepo } from '@main/repo/meta'
import { NotificationsRepo } from '@main/repo/notifications'
import { AlertSettingsRepo } from '@main/repo/alertSettings'
import { HolidayService } from '@main/services/HolidayService'
import { NotificationCenter } from '@main/services/NotificationCenter'
import { AlertMonitor } from '@main/services/AlertMonitor'
import { ReminderService } from '@main/services/ReminderService'
import { HolidayFetchError } from '@shared/timeIrHolidays'
import type { HolidayFeed, RendererBridge } from '@main/ports'
import type { SettingsSection } from '@shared/events'

const db = createTestDb()
withRollback(() => db)

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

class TimeIr implements HolidayFeed {
  up = true
  requests = 0
  async fetchYear(jy: number): Promise<unknown> {
    this.requests++
    if (!this.up) throw new HolidayFetchError('network', 'time.ir unreachable')
    return [{ date: `${jy}-01-01`, is_holiday: true, events: [{ description: 'نوروز', is_holiday: true }] }]
  }
}

function app() {
  const clock = new FakeClock('2026-09-24T09:00:00')
  const renderer = new SpyRendererBridge()
  const osNotifications = new SpyNotifier()
  const power = new FakePowerEvents()
  const meta = new MetaRepo(db)
  const timeIr = new TimeIr()
  const opened: SettingsSection[] = []

  const bridge: RendererBridge = {
    send: (channel, payload) => {
      renderer.send(channel, payload)
      if (channel === 'holidays:status') alerts.evaluate()
    }
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hengam-scenario-'))
  const holidays = new HolidayService(clock, timeIr, dataDir, dataDir, meta, power, bridge)
  const inbox = new NotificationCenter(new NotificationsRepo(db), clock, bridge)
  const settings = new AlertSettingsRepo(meta)
  const alerts = new AlertMonitor(
    clock,
    inbox,
    settings,
    { sync_failure: () => undefined, holiday_failure: () => holidays.getStatus().failingSince },
    osNotifications,
    (s) => opened.push(s)
  )
  const events = new EventsRepo(db, clock)
  const reminders = new ReminderService(db, clock, osNotifications, events, undefined, (r) => inbox.addReminder(r))

  /** Lets time pass in small steps, as the real timers would, letting async work settle. */
  const live = async (ms: number, step = MIN) => {
    for (let t = 0; t < ms; t += step) {
      clock.advance(Math.min(step, ms - t))
      await flush()
    }
  }
  const start = async () => {
    holidays.start()
    alerts.start()
    await flush()
  }
  const stop = () => {
    holidays.stop()
    alerts.stop()
  }
  return { clock, renderer, osNotifications, timeIr, holidays, inbox, settings, alerts, events, reminders, opened, live, start, stop }
}

describe('Scenario: time.ir is unreachable for longer than the holiday alert threshold', () => {
  it('raises exactly one alert after the threshold, keeps retrying with backoff, and resolves on recovery', async () => {
    // Given the user wants to hear about holiday failures after 1 day
    const a = app()
    a.settings.set({ holidayFailureMin: 24 * 60 })
    // And time.ir is unreachable
    a.timeIr.up = false

    // When the app starts and a little under a day passes
    await a.start()
    await a.live(23 * HOUR, 10 * MIN)

    // Then it has been retrying ever more slowly — at 0, 1, 3, 7, …, 1023 minutes (the
    // next is 17h later) — rather than hammering time.ir, but has not alerted yet
    expect(a.timeIr.requests).toBe(11)
    expect(a.inbox.list()).toEqual([])

    // When the failure passes the one-day mark
    await a.live(1 * HOUR, 10 * MIN)

    // Then the bell holds one active holiday alert, and one OS notification went out
    const [alert] = a.inbox.list()
    expect(alert).toMatchObject({ kind: 'holiday_failure', resolvedAt: undefined })
    expect(a.osNotifications.shown).toHaveLength(1)
    expect(a.osNotifications.shown[0].title).toBe('به‌روزرسانی تعطیلات رسمی ناموفق است')
    expect(a.renderer.sent.some((s) => s.channel === 'notifications:changed')).toBe(true)

    // And clicking that OS notification opens the holidays settings
    a.osNotifications.shown[0].onClick!()
    expect(a.opened).toEqual(['holidays'])

    // When time.ir comes back, the next retry (at most a day away) succeeds
    a.timeIr.up = true
    await a.live(DAY, 10 * MIN)

    // Then the alert is resolved by that very status push, not a minute later
    expect(a.inbox.list()[0]).toMatchObject({ id: alert.id, resolvedAt: expect.any(Number) })
    expect(a.holidays.getStatus()).toMatchObject({ phase: 'idle', failingSince: undefined })
    expect(a.osNotifications.shown).toHaveLength(1) // recovery is quiet
    a.stop()
  })

  it('a failure that recovers before the threshold never reaches the bell', async () => {
    const a = app()
    a.timeIr.up = false
    await a.start()
    await a.live(2 * HOUR, 10 * MIN)
    a.timeIr.up = true
    await a.live(DAY, 30 * MIN)
    expect(a.inbox.list()).toEqual([])
    expect(a.osNotifications.shown).toEqual([])
    a.stop()
  })

  it('lowering the threshold below an ongoing failure alerts on the next check', async () => {
    const a = app() // default holiday threshold: 3 days
    a.timeIr.up = false
    await a.start()
    await a.live(5 * HOUR, 30 * MIN)
    expect(a.inbox.list()).toEqual([])

    a.settings.set({ holidayFailureMin: 60 })
    a.alerts.evaluate() // what the settings:setAlerts IPC handler does
    expect(a.inbox.list()[0].kind).toBe('holiday_failure')
    a.stop()
  })
})

describe('Scenario: an event reminder fires', () => {
  it('shows an OS notification and leaves an unread entry in the bell that points at the event', async () => {
    const a = app()
    const startTs = new Date('2026-09-24T09:10:00').getTime()
    a.events.create({ title: 'جلسهٔ تیم', color: '#3b82f6', startTs, endTs: startTs + HOUR, allDay: false, reminders: [10] })

    a.reminders.checkOnce()

    expect(a.osNotifications.shown.map((n) => n.title)).toEqual(['جلسهٔ تیم'])
    expect(a.inbox.list()).toEqual([
      expect.objectContaining({ kind: 'reminder', title: 'جلسهٔ تیم', eventStartTs: startTs, readAt: undefined })
    ])

    // And opening the bell (mark all read) clears the unread state
    a.inbox.markAllRead()
    expect(a.inbox.list()[0].readAt).toBe(a.clock.now())
  })
})

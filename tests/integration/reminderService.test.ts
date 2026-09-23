import { describe, expect, it } from 'vitest'
import { createTestDb, withRollback } from '../support/db'
import { EventsRepo } from '@main/repo/events'
import { ReminderService } from '@main/services/ReminderService'
import { FakeClock } from '../support/fakes/FakeClock'
import { SpyNotifier } from '../support/fakes/SpyNotifier'

describe('ReminderService', () => {
  const db = createTestDb()
  withRollback(() => db)

  function setup(nowIso: string) {
    const clock = new FakeClock(nowIso)
    const events = new EventsRepo(db, clock)
    const notifier = new SpyNotifier()
    const reminders = new ReminderService(db, clock, notifier, events)
    return { clock, events, notifier, reminders }
  }

  it('fires exactly once per occurrence, at the reminder offset', () => {
    const { clock, events, notifier, reminders } = setup('2026-09-22T08:50:00')
    events.create({
      title: 'جلسه',
      categoryId: 'work',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminderMin: 10
    })

    reminders.checkOnce() // at 08:50, exactly at the reminder offset
    expect(notifier.shown).toHaveLength(1)

    clock.setNow('2026-09-22T08:55:00')
    reminders.checkOnce() // should not fire again
    expect(notifier.shown).toHaveLength(1)
  })

  it('stays silent if checked after the event already started', () => {
    const { events, notifier, reminders } = setup('2026-09-22T09:30:00')
    events.create({
      title: 'جلسه',
      categoryId: 'work',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminderMin: 10
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(0)
  })

  it('fires for each occurrence of a recurring event', () => {
    const { clock, events, notifier, reminders } = setup('2026-09-22T08:55:00')
    events.create({
      title: 'روزانه',
      categoryId: 'work',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T09:30:00').getTime(),
      allDay: false,
      reminderMin: 5,
      rrule: { freq: 'daily', interval: 1, count: 3 }
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1)

    clock.setNow('2026-09-23T08:55:00')
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(2)
  })

  it('a reminder is rescheduled when its event is edited', () => {
    const { clock, events, notifier, reminders } = setup('2026-09-22T08:00:00')
    const ev = events.create({
      title: 'جلسه',
      categoryId: 'work',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminderMin: 5
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(0) // too early (55 min before)

    events.update(ev.id, { startTs: new Date('2026-09-22T08:05:00').getTime(), endTs: new Date('2026-09-22T09:05:00').getTime() })
    clock.setNow('2026-09-22T08:00:30')
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1) // now within 5 min of the new start
  })

  it('fired_reminders rows survive a container rebuild against the same database', () => {
    const { events, notifier, reminders } = setup('2026-09-22T08:55:00')
    events.create({
      title: 'جلسه',
      categoryId: 'work',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T09:30:00').getTime(),
      allDay: false,
      reminderMin: 5
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1)

    // Simulate an app restart: new clock/notifier/service, same db.
    const clock2 = new FakeClock('2026-09-22T08:56:00')
    const events2 = new EventsRepo(db, clock2)
    const notifier2 = new SpyNotifier()
    const reminders2 = new ReminderService(db, clock2, notifier2, events2)
    reminders2.checkOnce()
    expect(notifier2.shown).toHaveLength(0) // already recorded as fired
  })
})

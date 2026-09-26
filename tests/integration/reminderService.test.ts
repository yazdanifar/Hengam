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
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminders: [10]
    })

    reminders.checkOnce() // at 08:50, exactly at the reminder offset
    expect(notifier.shown).toHaveLength(1)

    clock.setNow('2026-09-22T08:55:00')
    reminders.checkOnce() // should not fire again
    expect(notifier.shown).toHaveLength(1)
  })

  it('fires each offset of a multi-reminder event separately, at its own time', () => {
    const { clock, events, notifier, reminders } = setup('2026-09-22T08:00:00')
    events.create({
      title: 'جلسه',
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminders: [10, 60]
    })

    reminders.checkOnce() // at 08:00, exactly at the 60-minute offset
    expect(notifier.shown).toHaveLength(1)

    clock.setNow('2026-09-22T08:30:00')
    reminders.checkOnce() // between offsets: nothing new
    expect(notifier.shown).toHaveLength(1)

    clock.setNow('2026-09-22T08:50:00') // exactly at the 10-minute offset
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(2)
  })

  it('a reminder well beyond the old 24h lookahead still fires', () => {
    const { events, notifier, reminders } = setup('2026-09-21T09:00:00')
    events.create({
      title: 'یادآوری هفتگی',
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminders: [1440] // 1 day before — 24h ahead of "now", right at the old lookahead edge
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1)
  })

  it('coalesces several overdue offsets (e.g. after being closed) into one notification', () => {
    const { events, notifier, reminders } = setup('2026-09-22T08:58:00')
    events.create({
      title: 'جلسه',
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminders: [10, 60] // both offsets are already overdue at 08:58
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1)

    // Neither offset fires again later.
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1)
  })

  it('stays silent if checked after the event already started', () => {
    const { events, notifier, reminders } = setup('2026-09-22T09:30:00')
    events.create({
      title: 'جلسه',
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminders: [10]
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(0)
  })

  it('fires for each occurrence of a recurring event', () => {
    const { clock, events, notifier, reminders } = setup('2026-09-22T08:55:00')
    events.create({
      title: 'روزانه',
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T09:30:00').getTime(),
      allDay: false,
      reminders: [5],
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
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminders: [5]
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
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T09:30:00').getTime(),
      allDay: false,
      reminders: [5]
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

  it('a 0-minute ("at start time") reminder fires once the event starts', () => {
    const { clock, events, notifier, reminders } = setup('2026-09-22T08:59:50')
    events.create({
      title: 'جلسه',
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminders: [0]
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(0) // not due yet

    clock.setNow('2026-09-22T09:00:20') // the next sweep lands just after the start
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1)
    expect(notifier.shown[0].body).toContain('همین حالا')
  })

  it('a late sweep reports the real time left, not the stale offset', () => {
    const { events, notifier, reminders } = setup('2026-09-22T08:58:00')
    events.create({
      title: 'جلسه',
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminders: [60]
    })
    reminders.checkOnce()
    expect(notifier.shown[0].body).toContain('۲ دقیقه دیگر')
  })

  it('an on-time sweep reports the offset itself', () => {
    const { events, notifier, reminders } = setup('2026-09-22T08:00:10')
    events.create({
      title: 'جلسه',
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminders: [60]
    })
    reminders.checkOnce()
    expect(notifier.shown[0].body).toContain('۱ ساعت دیگر')
  })

  it('moving one occurrence of a series re-arms that occurrence\'s reminder', () => {
    const { clock, events, notifier, reminders } = setup('2026-09-22T08:50:00')
    const ev = events.create({
      title: 'روزانه',
      color: '#3b82f6',
      startTs: new Date('2026-09-22T09:00:00').getTime(),
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      rrule: { freq: 'daily', interval: 1 },
      reminders: [10]
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1)

    const occurrenceStartTs = new Date('2026-09-22T09:00:00').getTime()
    // A rename alone must not re-notify...
    events.addException({ eventId: ev.id, occurrenceStartTs, kind: 'override', override: { title: 'تغییر نام' } })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1)

    // ...but moving it later does, at the new time.
    events.addException({
      eventId: ev.id,
      occurrenceStartTs,
      kind: 'override',
      override: {
        title: 'تغییر نام',
        startTs: new Date('2026-09-22T09:30:00').getTime(),
        endTs: new Date('2026-09-22T10:30:00').getTime()
      }
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1) // 40 min before the new start: not yet
    clock.setNow('2026-09-22T09:20:00')
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(2)
  })

  it('a remote change to the start time re-arms the reminder', () => {
    const { clock, events, notifier, reminders } = setup('2026-09-22T08:50:00')
    const base = {
      title: 'جلسه',
      color: '#3b82f6',
      endTs: new Date('2026-09-22T10:00:00').getTime(),
      allDay: false,
      reminders: [10]
    }
    events.upsertFromRemote({
      calendarId: 'cal',
      googleId: 'g1',
      remoteUpdatedAt: 1,
      local: { ...base, startTs: new Date('2026-09-22T09:00:00').getTime() }
    })
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(1)

    events.upsertFromRemote({
      calendarId: 'cal',
      googleId: 'g1',
      remoteUpdatedAt: 2,
      local: { ...base, startTs: new Date('2026-09-22T09:05:00').getTime(), endTs: new Date('2026-09-22T10:05:00').getTime() }
    })
    clock.setNow('2026-09-22T08:55:00')
    reminders.checkOnce()
    expect(notifier.shown).toHaveLength(2)
  })
})

describe('ReminderService — inbox and click-through', () => {
  const db = createTestDb()
  withRollback(() => db)

  it('reports each shown reminder to onFired (for the bell) and routes a click to onFocusDay', () => {
    const clock = new FakeClock('2026-09-22T08:50:00')
    const events = new EventsRepo(db, clock)
    const notifier = new SpyNotifier()
    const fired: { title: string; body: string; eventStartTs: number }[] = []
    const focused: number[] = []
    const reminders = new ReminderService(db, clock, notifier, events, (ts) => focused.push(ts), (r) => fired.push(r))
    const startTs = new Date('2026-09-22T09:00:00').getTime()
    events.create({ title: 'جلسه', color: '#3b82f6', startTs, endTs: startTs + 3_600_000, allDay: false, reminders: [10] })

    reminders.checkOnce()
    expect(fired).toEqual([{ title: 'جلسه', body: notifier.shown[0].body, eventStartTs: startTs }])
    expect(fired[0].body).toMatch(/۱۰ دقیقه دیگر$/)

    notifier.shown[0].onClick!()
    expect(focused).toEqual([startTs])
  })
})

describe('ReminderService — lifecycle', () => {
  const db = createTestDb()
  withRollback(() => db)

  it('start() sweeps at once and then every 30 seconds; stop() ends the loop', () => {
    const clock = new FakeClock('2026-09-22T08:49:00')
    const events = new EventsRepo(db, clock)
    const notifier = new SpyNotifier()
    const reminders = new ReminderService(db, clock, notifier, events)
    const startTs = new Date('2026-09-22T09:00:00').getTime()
    events.create({ title: 'a', color: '#3b82f6', startTs, endTs: startTs + 3_600_000, allDay: false, reminders: [10] })
    events.create({ title: 'b', color: '#3b82f6', startTs: startTs + 3_600_000, endTs: startTs + 7_200_000, allDay: false, reminders: [10] })

    reminders.stop() // safe before start
    reminders.start()
    expect(notifier.shown).toEqual([])
    clock.advance(60_000) // 08:50 — "a" is due
    expect(notifier.shown.map((n) => n.title)).toEqual(['a'])

    reminders.stop()
    clock.advance(3_600_000) // "b" would be due at 09:50
    expect(notifier.shown.map((n) => n.title)).toEqual(['a'])
  })
})

describe('ReminderService — events without reminders', () => {
  const db = createTestDb()
  withRollback(() => db)

  it('stays silent for an upcoming event that has no reminders', () => {
    const clock = new FakeClock('2026-09-22T08:59:00')
    const events = new EventsRepo(db, clock)
    const notifier = new SpyNotifier()
    const startTs = new Date('2026-09-22T09:00:00').getTime()
    events.create({ title: 'quiet', color: '#3b82f6', startTs, endTs: startTs + 3_600_000, allDay: false })
    new ReminderService(db, clock, notifier, events).checkOnce()
    expect(notifier.shown).toEqual([])
  })
})

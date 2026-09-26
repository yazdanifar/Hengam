import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, withRollback } from '../support/db'
import { EventsRepo } from '@main/repo/events'
import { FakeClock } from '../support/fakes/FakeClock'
import { toGregorian } from '@shared/jalali'

describe('EventsRepo', () => {
  const db = createTestDb()
  withRollback(() => db)
  const clock = new FakeClock('2026-09-22T08:00:00')
  const repo = new EventsRepo(db, clock)

  it('creates and reads back an event', () => {
    const ev = repo.create({
      title: 'جلسه تیم',
      color: '#3b82f6',
      startTs: toGregorian(1405, 6, 31).getTime() + 9 * 3600_000,
      endTs: toGregorian(1405, 6, 31).getTime() + 10 * 3600_000,
      allDay: false
    })
    const loaded = repo.getById(ev.id)
    expect(loaded?.title).toBe('جلسه تیم')
    expect(loaded?.dirty).toBe(true)
  })

  it('update sets updated_at and dirty', () => {
    const ev = repo.create({
      title: 'a',
      color: '#3b82f6',
      startTs: 1000,
      endTs: 2000,
      allDay: false
    })
    clock.setNow('2026-09-22T09:00:00')
    repo.update(ev.id, { title: 'b' })
    const loaded = repo.getById(ev.id)
    expect(loaded?.title).toBe('b')
    expect(loaded?.updatedAt).toBe(clock.now())
    expect(loaded?.dirty).toBe(true)
  })

  it('clears fired_reminders when startTs or the reminder list changes, not on a plain rename', () => {
    const ev = repo.create({
      title: 'یادآوری',
      color: '#3b82f6',
      startTs: 5000,
      endTs: 6000,
      allDay: false,
      reminders: [10]
    })
    const markFired = () =>
      db
        .prepare('INSERT INTO fired_reminders (event_id, occurrence_start_ts, minutes_before) VALUES (?, ?, ?)')
        .run(ev.id, ev.startTs, 10)
    const fired = () =>
      db.prepare('SELECT 1 FROM fired_reminders WHERE event_id = ?').get(ev.id) !== undefined

    markFired()
    repo.update(ev.id, { title: 'یادآوری تغییر یافته' })
    expect(fired()).toBe(true) // a rename alone must not re-arm the reminder

    repo.update(ev.id, { reminders: [60] })
    expect(fired()).toBe(false) // a changed reminder list must re-arm it

    markFired()
    repo.update(ev.id, { startTs: 9000, endTs: 10000 })
    expect(fired()).toBe(false) // a moved start time must re-arm it
  })

  it('reordering the reminder list without changing its values does not re-arm', () => {
    const ev = repo.create({
      title: 'چند اعلان',
      color: '#3b82f6',
      startTs: 5000,
      endTs: 6000,
      allDay: false,
      reminders: [10, 60]
    })
    db.prepare('INSERT INTO fired_reminders (event_id, occurrence_start_ts, minutes_before) VALUES (?, ?, ?)').run(
      ev.id,
      ev.startTs,
      10
    )
    repo.update(ev.id, { reminders: [60, 10] })
    const fired = db.prepare('SELECT 1 FROM fired_reminders WHERE event_id = ?').get(ev.id) !== undefined
    expect(fired).toBe(true)
  })

  it('soft delete hides the event from getById but keeps the row', () => {
    const ev = repo.create({ title: 'x', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false })
    repo.softDelete(ev.id)
    expect(repo.getById(ev.id)).toBeUndefined()
    const raw = db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id)
    expect(raw).toBeDefined()
  })

  it('rangeQuery finds a recurring series across a week boundary, applying exceptions', () => {
    const start = toGregorian(1405, 1, 1).getTime() + 9 * 3600_000
    const ev = repo.create({
      title: 'روزانه',
      color: '#3b82f6',
      startTs: start,
      endTs: start + 3600_000,
      allDay: false,
      rrule: { freq: 'daily', interval: 1, count: 10 }
    })
    repo.addException({ eventId: ev.id, occurrenceStartTs: start + 2 * 86400_000, kind: 'skip' })

    const occ = repo.rangeQuery(start, start + 5 * 86400_000)
    expect(occ.length).toBe(4) // 5 days requested, 1 skipped
    expect(occ.every((o) => o.eventId === ev.id)).toBe(true)
  })
})

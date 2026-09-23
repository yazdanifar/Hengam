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

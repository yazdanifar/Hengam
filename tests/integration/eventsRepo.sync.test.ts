import { describe, expect, it } from 'vitest'
import { createTestDb, withRollback } from '../support/db'
import { EventsRepo } from '@main/repo/events'
import { FakeClock } from '../support/fakes/FakeClock'

describe('EventsRepo — sync additions', () => {
  const db = createTestDb()
  withRollback(() => db)
  const clock = new FakeClock('2026-09-22T08:00:00')
  const repo = new EventsRepo(db, clock)

  function makeEvent(overrides: Partial<Parameters<EventsRepo['create']>[0]> = {}) {
    return repo.create({ title: 'x', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false, ...overrides })
  }

  it('a freshly created event is dirty with no google identity', () => {
    const ev = makeEvent()
    expect(ev.dirty).toBe(true)
    expect(ev.googleId).toBeUndefined()
  })

  it('create(..., { dirty: false, ... }) inserts a clean, already-identified row (the pull path)', () => {
    const ev = repo.create(
      { title: 'from google', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false },
      { dirty: false, calendarId: 'primary', googleId: 'g1', etag: 'e1', remoteUpdatedAt: 500 }
    )
    const loaded = repo.getById(ev.id)!
    expect(loaded.dirty).toBe(false)
    expect(loaded.googleId).toBe('g1')
    expect(loaded.calendarId).toBe('primary')
    expect(loaded.etag).toBe('e1')
  })

  it('listDirty includes soft-deleted rows', () => {
    const ev = makeEvent()
    repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    expect(repo.listDirty().find((e) => e.id === ev.id)).toBeUndefined()
    repo.softDelete(ev.id)
    expect(repo.listDirty().find((e) => e.id === ev.id)).toBeDefined()
  })

  it('markSynced records identity and clears dirty', () => {
    const ev = makeEvent()
    repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1', etag: 'e1', remoteUpdatedAt: 123 })
    const loaded = repo.getById(ev.id)!
    expect(loaded.dirty).toBe(false)
    expect(loaded.googleId).toBe('g1')
    expect(loaded.calendarId).toBe('primary')
    expect(loaded.etag).toBe('e1')
  })

  it('clearDirty clears the flag without touching identity', () => {
    const ev = makeEvent()
    repo.clearDirty(ev.id)
    const loaded = repo.getById(ev.id)!
    expect(loaded.dirty).toBe(false)
    expect(loaded.googleId).toBeUndefined()
  })

  it('findByGoogleId looks up by (calendar_id, google_id)', () => {
    const ev = makeEvent()
    repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    expect(repo.findByGoogleId('primary', 'g1')?.id).toBe(ev.id)
    expect(repo.findByGoogleId('other-calendar', 'g1')).toBeUndefined()
  })

  it('upsertFromRemote updates an existing row matched by (calendar_id, google_id)', () => {
    const ev = makeEvent()
    repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })

    const id = repo.upsertFromRemote({
      calendarId: 'primary',
      googleId: 'g1',
      etag: 'e2',
      remoteUpdatedAt: 999,
      local: { title: 'updated remotely', color: '#3b82f6', startTs: 3000, endTs: 4000, allDay: false }
    })

    expect(id).toBe(ev.id)
    const loaded = repo.getById(ev.id)!
    expect(loaded.title).toBe('updated remotely')
    expect(loaded.dirty).toBe(false)
    expect(loaded.etag).toBe('e2')
  })

  it('upsertFromRemote adopts a local row by hengamId when no (calendar_id, google_id) match exists', () => {
    const ev = makeEvent({ title: 'locally created' })

    const id = repo.upsertFromRemote({
      calendarId: 'primary',
      googleId: 'g-new',
      remoteUpdatedAt: 1,
      local: { title: 'locally created', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false },
      adoptLocalId: ev.id
    })

    expect(id).toBe(ev.id)
    expect(repo.findByGoogleId('primary', 'g-new')?.id).toBe(ev.id)
    // Only one row exists — it was adopted, not duplicated.
    const all = db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number }
    expect(all.c).toBe(1)
  })

  it('upsertFromRemote inserts a new row when there is no match and no adoptable local id', () => {
    const id = repo.upsertFromRemote({
      calendarId: 'primary',
      googleId: 'g-brand-new',
      remoteUpdatedAt: 1,
      local: { title: 'brand new', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false }
    })
    expect(repo.getById(id)?.title).toBe('brand new')
  })

  it('upsertFromRemote does not resurrect a row deleted locally after the remote update', () => {
    const ev = makeEvent()
    repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    clock.setNow('2026-09-22T09:00:00')
    repo.softDelete(ev.id)

    repo.upsertFromRemote({
      calendarId: 'primary',
      googleId: 'g1',
      remoteUpdatedAt: new Date('2026-09-22T08:30:00').getTime(), // older than the local delete
      local: { title: 'stale remote edit', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false }
    })

    expect(repo.getById(ev.id)).toBeUndefined() // still deleted
  })

  it('upsertFromRemote does resurrect when the remote update is newer than the local delete', () => {
    const ev = makeEvent()
    repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    clock.setNow('2026-09-22T09:00:00')
    repo.softDelete(ev.id)

    repo.upsertFromRemote({
      calendarId: 'primary',
      googleId: 'g1',
      remoteUpdatedAt: new Date('2026-09-22T10:00:00').getTime(), // newer than the local delete
      local: { title: 'someone re-edited it', color: '#3b82f6', startTs: 1000, endTs: 2000, allDay: false }
    })

    expect(repo.getById(ev.id)?.title).toBe('someone re-edited it')
  })

  it('deleteByGoogleId hard-deletes and cascades exceptions', () => {
    const ev = makeEvent({ rrule: { freq: 'daily', interval: 1, count: 5 } })
    repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
    repo.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'skip' })

    repo.deleteByGoogleId('primary', 'g1')

    const raw = db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id)
    expect(raw).toBeUndefined()
    const exceptions = db.prepare('SELECT * FROM event_exceptions WHERE event_id = ?').all(ev.id)
    expect(exceptions).toHaveLength(0)
  })

  it('purgeDeleted removes the row entirely', () => {
    const ev = makeEvent()
    repo.softDelete(ev.id)
    repo.purgeDeleted(ev.id)
    const raw = db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id)
    expect(raw).toBeUndefined()
  })

  it('clearAllSyncIdentity strips identity from every event and exception, marking both dirty', () => {
    const ev = makeEvent({ rrule: { freq: 'daily', interval: 1, count: 5 } })
    repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1', etag: 'e1' })
    repo.clearDirty(ev.id)
    repo.upsertExceptionFromRemote({
      eventId: ev.id,
      occurrenceStartTs: 1500,
      kind: 'override',
      googleId: 'gx1',
      etag: 'ex1'
    })

    repo.clearAllSyncIdentity()

    const loaded = repo.getById(ev.id)!
    expect(loaded.googleId).toBeUndefined()
    expect(loaded.calendarId).toBeUndefined()
    expect(loaded.etag).toBeUndefined()
    expect(loaded.dirty).toBe(true)
    const exRow = db.prepare('SELECT dirty, google_id FROM event_exceptions WHERE event_id = ?').get(ev.id)
    expect(exRow).toMatchObject({ dirty: 1, google_id: null })
  })

  describe('exceptions — sync', () => {
    it('addException marks the exception dirty', () => {
      const ev = makeEvent()
      repo.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'override', override: { title: 'x' } })
      const rows = db.prepare('SELECT dirty FROM event_exceptions WHERE event_id = ?').all(ev.id) as { dirty: number }[]
      expect(rows[0].dirty).toBe(1)
    })

    it('a skip exception on a Jalali monthly/yearly series dirties the parent (RDATE must be regenerated)', () => {
      const ev = makeEvent({ rrule: { freq: 'monthly', interval: 1 } })
      repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
      repo.clearDirty(ev.id)

      repo.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'skip' })

      expect(repo.getById(ev.id)?.dirty).toBe(true)
    })

    it('a skip exception on a plain (non-Jalali-only) series does not dirty the parent', () => {
      const ev = makeEvent({ rrule: { freq: 'daily', interval: 1 } })
      repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
      repo.clearDirty(ev.id)

      repo.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'skip' })

      expect(repo.getById(ev.id)?.dirty).toBe(false)
    })

    it('an override exception does not dirty the parent', () => {
      const ev = makeEvent({ rrule: { freq: 'monthly', interval: 1 } })
      repo.markSynced(ev.id, { calendarId: 'primary', googleId: 'g1' })
      repo.clearDirty(ev.id)

      repo.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'override', override: { title: 'x' } })

      expect(repo.getById(ev.id)?.dirty).toBe(false)
    })

    it('listDirtyExceptions returns only dirty rows', () => {
      const ev = makeEvent()
      repo.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'skip' })
      expect(repo.listDirtyExceptions().length).toBe(1)
      repo.markExceptionSynced(ev.id, 1500, { googleId: 'gx1' })
      expect(repo.listDirtyExceptions().length).toBe(0)
    })

    it('markExceptionSynced records identity and clears dirty', () => {
      const ev = makeEvent()
      repo.addException({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'skip' })
      repo.markExceptionSynced(ev.id, 1500, { googleId: 'gx1', etag: 'ex1', remoteUpdatedAt: 42 })
      const found = repo.findExceptionByGoogleId('gx1')!
      expect(found.eventId).toBe(ev.id)
      expect(found.dirty).toBe(false)
      expect(found.etag).toBe('ex1')
    })

    it('upsertExceptionFromRemote inserts a clean exception row', () => {
      const ev = makeEvent()
      repo.upsertExceptionFromRemote({
        eventId: ev.id,
        occurrenceStartTs: 1500,
        kind: 'override',
        override: { title: 'from google' },
        googleId: 'gx1',
        etag: 'ex1',
        remoteUpdatedAt: 42
      })
      const exceptions = repo.listExceptions(ev.id)
      expect(exceptions).toHaveLength(1)
      expect(exceptions[0].override?.title).toBe('from google')
      expect(repo.listDirtyExceptions()).toHaveLength(0)
    })

    it('upsertExceptionFromRemote upserts (same event/occurrence) rather than duplicating', () => {
      const ev = makeEvent()
      repo.upsertExceptionFromRemote({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'skip', googleId: 'gx1' })
      repo.upsertExceptionFromRemote({ eventId: ev.id, occurrenceStartTs: 1500, kind: 'override', googleId: 'gx1', override: { title: 'y' } })
      expect(repo.listExceptions(ev.id)).toHaveLength(1)
      expect(repo.listExceptions(ev.id)[0].kind).toBe('override')
    })

    it('findExceptionByGoogleId returns undefined for an unknown id', () => {
      expect(repo.findExceptionByGoogleId('nope')).toBeUndefined()
    })
  })
})

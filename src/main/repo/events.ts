import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { expandOccurrences } from '@shared/recurrence'
import type { EventException, EventRecord, Occurrence, RecurrenceRule } from '@shared/types'
import type { Clock } from '../ports'

interface EventRow {
  id: string
  title: string
  notes: string | null
  category_id: string
  start_ts: number
  end_ts: number
  all_day: number
  rrule_json: string | null
  reminder_min: number | null
  created_at: number
  updated_at: number
  calendar_id: string | null
  google_id: string | null
  etag: string | null
  dirty: number
  deleted_at: number | null
}

function rowToEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    categoryId: row.category_id,
    startTs: row.start_ts,
    endTs: row.end_ts,
    allDay: !!row.all_day,
    rrule: row.rrule_json ? (JSON.parse(row.rrule_json) as RecurrenceRule) : undefined,
    reminderMin: row.reminder_min ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    calendarId: row.calendar_id ?? undefined,
    googleId: row.google_id ?? undefined,
    etag: row.etag ?? undefined,
    dirty: !!row.dirty,
    deletedAt: row.deleted_at ?? undefined
  }
}

export interface CreateEventInput {
  title: string
  notes?: string
  categoryId: string
  startTs: number
  endTs: number
  allDay: boolean
  rrule?: RecurrenceRule
  reminderMin?: number
}

export class EventsRepo {
  constructor(
    private db: Database.Database,
    private clock: Clock
  ) {}

  create(input: CreateEventInput): EventRecord {
    const now = this.clock.now()
    const record: EventRecord = {
      id: randomUUID(),
      title: input.title,
      notes: input.notes,
      categoryId: input.categoryId,
      startTs: input.startTs,
      endTs: input.endTs,
      allDay: input.allDay,
      rrule: input.rrule,
      reminderMin: input.reminderMin,
      createdAt: now,
      updatedAt: now,
      dirty: true
    }
    this.db
      .prepare(
        `INSERT INTO events (id, title, notes, category_id, start_ts, end_ts, all_day, rrule_json, reminder_min, created_at, updated_at, dirty)
         VALUES (@id, @title, @notes, @categoryId, @startTs, @endTs, @allDay, @rruleJson, @reminderMin, @createdAt, @updatedAt, 1)`
      )
      .run({
        id: record.id,
        title: record.title,
        notes: record.notes ?? null,
        categoryId: record.categoryId,
        startTs: record.startTs,
        endTs: record.endTs,
        allDay: record.allDay ? 1 : 0,
        rruleJson: record.rrule ? JSON.stringify(record.rrule) : null,
        reminderMin: record.reminderMin ?? null,
        createdAt: now,
        updatedAt: now
      })
    return record
  }

  getById(id: string): EventRecord | undefined {
    const row = this.db.prepare('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL').get(id) as
      | EventRow
      | undefined
    return row ? rowToEvent(row) : undefined
  }

  update(
    id: string,
    patch: Partial<CreateEventInput>
  ): void {
    const existing = this.getById(id)
    if (!existing) return
    const now = this.clock.now()
    const merged = { ...existing, ...patch }
    this.db
      .prepare(
        `UPDATE events SET title=@title, notes=@notes, category_id=@categoryId, start_ts=@startTs, end_ts=@endTs,
         all_day=@allDay, rrule_json=@rruleJson, reminder_min=@reminderMin, updated_at=@updatedAt, dirty=1
         WHERE id=@id`
      )
      .run({
        id,
        title: merged.title,
        notes: merged.notes ?? null,
        categoryId: merged.categoryId,
        startTs: merged.startTs,
        endTs: merged.endTs,
        allDay: merged.allDay ? 1 : 0,
        rruleJson: merged.rrule ? JSON.stringify(merged.rrule) : null,
        reminderMin: merged.reminderMin ?? null,
        updatedAt: now
      })
  }

  /** Soft-delete: kept until pushed to Google, then purged by the sync engine. */
  softDelete(id: string): void {
    this.db
      .prepare('UPDATE events SET deleted_at = ?, dirty = 1 WHERE id = ?')
      .run(this.clock.now(), id)
  }

  purgeDeleted(id: string): void {
    this.db.prepare('DELETE FROM events WHERE id = ?').run(id)
  }

  addException(ex: EventException): void {
    this.db
      .prepare(
        `INSERT INTO event_exceptions (event_id, occurrence_start_ts, kind, override_json)
         VALUES (@eventId, @occurrenceStartTs, @kind, @overrideJson)
         ON CONFLICT(event_id, occurrence_start_ts) DO UPDATE SET kind=excluded.kind, override_json=excluded.override_json`
      )
      .run({
        eventId: ex.eventId,
        occurrenceStartTs: ex.occurrenceStartTs,
        kind: ex.kind,
        overrideJson: ex.override ? JSON.stringify(ex.override) : null
      })
  }

  listExceptions(eventId: string): EventException[] {
    const rows = this.db
      .prepare('SELECT * FROM event_exceptions WHERE event_id = ?')
      .all(eventId) as { event_id: string; occurrence_start_ts: number; kind: 'skip' | 'override'; override_json: string | null }[]
    return rows.map((r) => ({
      eventId: r.event_id,
      occurrenceStartTs: r.occurrence_start_ts,
      kind: r.kind,
      override: r.override_json ? JSON.parse(r.override_json) : undefined
    }))
  }

  /** All non-deleted base events that could possibly produce an occurrence in [rangeStart, rangeEnd). */
  private baseEventsForRange(rangeStart: number, rangeEnd: number): EventRow[] {
    // Recurring events (rrule_json not null) may start long before the range; only bound
    // non-recurring events by their own start/end for the query, and let expandOccurrences
    // do the precise filtering.
    return this.db
      .prepare(
        `SELECT * FROM events WHERE deleted_at IS NULL AND (
           (rrule_json IS NOT NULL AND start_ts < ?)
           OR (rrule_json IS NULL AND start_ts < ? AND end_ts > ?)
         )`
      )
      .all(rangeEnd, rangeEnd, rangeStart) as EventRow[]
  }

  rangeQuery(rangeStart: number, rangeEnd: number): Occurrence[] {
    const rows = this.baseEventsForRange(rangeStart, rangeEnd)
    const out: Occurrence[] = []
    for (const row of rows) {
      const ev = rowToEvent(row)
      const exceptions = this.listExceptions(ev.id)
      out.push(...expandOccurrences(ev, rangeStart, rangeEnd, exceptions))
    }
    out.sort((a, b) => a.startTs - b.startTs)
    return out
  }
}

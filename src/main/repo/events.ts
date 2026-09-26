import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { expandOccurrences } from '@shared/recurrence'
import { normalizeReminders } from '@shared/reminders'
import type { EventException, EventRecord, Occurrence, RecurrenceRule } from '@shared/types'
import type { Clock } from '../ports'

interface EventRow {
  id: string
  title: string
  notes: string | null
  color: string
  start_ts: number
  end_ts: number
  all_day: number
  rrule_json: string | null
  reminders_json: string | null
  created_at: number
  updated_at: number
  calendar_id: string | null
  google_id: string | null
  etag: string | null
  dirty: number
  deleted_at: number | null
  remote_updated_at: number | null
}

function rowToEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    color: row.color,
    startTs: row.start_ts,
    endTs: row.end_ts,
    allDay: !!row.all_day,
    rrule: row.rrule_json ? (JSON.parse(row.rrule_json) as RecurrenceRule) : undefined,
    reminders: row.reminders_json ? (JSON.parse(row.reminders_json) as number[]) : [],
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
  color: string
  startTs: number
  endTs: number
  allDay: boolean
  rrule?: RecurrenceRule
  reminders?: number[]
}

export interface CreateEventOpts {
  /** Defaults to true — a locally-authored event is dirty until pushed. Pull inserts pass false. */
  dirty?: boolean
  calendarId?: string
  googleId?: string
  etag?: string
  remoteUpdatedAt?: number
}

export interface MarkSyncedInput {
  calendarId: string
  googleId: string
  etag?: string
  remoteUpdatedAt?: number
}

export interface UpsertFromRemoteInput {
  calendarId: string
  googleId: string
  etag?: string
  remoteUpdatedAt: number
  local: CreateEventInput
  /** Adopts this local id instead of inserting a new row (identity match #2 — hengamId). */
  adoptLocalId?: string
}

export interface SyncEventException extends EventException {
  googleId?: string
  etag?: string
  remoteUpdatedAt?: number
  dirty?: boolean
}

interface ExceptionRow {
  event_id: string
  occurrence_start_ts: number
  kind: 'skip' | 'override'
  override_json: string | null
  google_id: string | null
  etag: string | null
  dirty: number
  remote_updated_at: number | null
}

function rowToException(row: ExceptionRow): SyncEventException {
  return {
    eventId: row.event_id,
    occurrenceStartTs: row.occurrence_start_ts,
    kind: row.kind,
    override: row.override_json ? JSON.parse(row.override_json) : undefined,
    googleId: row.google_id ?? undefined,
    etag: row.etag ?? undefined,
    dirty: !!row.dirty,
    remoteUpdatedAt: row.remote_updated_at ?? undefined
  }
}

export class EventsRepo {
  constructor(
    private db: Database.Database,
    private clock: Clock
  ) {}

  create(input: CreateEventInput, opts: CreateEventOpts = {}): EventRecord {
    const now = this.clock.now()
    const dirty = opts.dirty ?? true
    const record: EventRecord = {
      id: randomUUID(),
      title: input.title,
      notes: input.notes,
      color: input.color,
      startTs: input.startTs,
      endTs: input.endTs,
      allDay: input.allDay,
      rrule: input.rrule,
      reminders: normalizeReminders(input.reminders ?? []),
      createdAt: now,
      updatedAt: now,
      calendarId: opts.calendarId,
      googleId: opts.googleId,
      etag: opts.etag,
      dirty
    }
    this.db
      .prepare(
        `INSERT INTO events (id, title, notes, color, start_ts, end_ts, all_day, rrule_json, reminders_json,
                              created_at, updated_at, calendar_id, google_id, etag, dirty, remote_updated_at)
         VALUES (@id, @title, @notes, @color, @startTs, @endTs, @allDay, @rruleJson, @remindersJson,
                 @createdAt, @updatedAt, @calendarId, @googleId, @etag, @dirty, @remoteUpdatedAt)`
      )
      .run({
        id: record.id,
        title: record.title,
        notes: record.notes ?? null,
        color: record.color,
        startTs: record.startTs,
        endTs: record.endTs,
        allDay: record.allDay ? 1 : 0,
        rruleJson: record.rrule ? JSON.stringify(record.rrule) : null,
        remindersJson: record.reminders.length ? JSON.stringify(record.reminders) : null,
        createdAt: now,
        updatedAt: now,
        calendarId: opts.calendarId ?? null,
        googleId: opts.googleId ?? null,
        etag: opts.etag ?? null,
        dirty: dirty ? 1 : 0,
        remoteUpdatedAt: opts.remoteUpdatedAt ?? null
      })
    return record
  }

  getById(id: string): EventRecord | undefined {
    const row = this.db.prepare('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL').get(id) as
      | EventRow
      | undefined
    return row ? rowToEvent(row) : undefined
  }

  /** Like getById but also returns soft-deleted rows — needed by sync to compare timestamps. */
  private getByIdIncludingDeleted(id: string): EventRecord | undefined {
    const row = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined
    return row ? rowToEvent(row) : undefined
  }

  update(id: string, patch: Partial<CreateEventInput>): void {
    const existing = this.getById(id)
    if (!existing) return
    const now = this.clock.now()
    const merged = { ...existing, ...patch, reminders: normalizeReminders(patch.reminders ?? existing.reminders) }
    this.db
      .prepare(
        `UPDATE events SET title=@title, notes=@notes, color=@color, start_ts=@startTs, end_ts=@endTs,
         all_day=@allDay, rrule_json=@rruleJson, reminders_json=@remindersJson, updated_at=@updatedAt, dirty=1
         WHERE id=@id`
      )
      .run({
        id,
        title: merged.title,
        notes: merged.notes ?? null,
        color: merged.color,
        startTs: merged.startTs,
        endTs: merged.endTs,
        allDay: merged.allDay ? 1 : 0,
        rruleJson: merged.rrule ? JSON.stringify(merged.rrule) : null,
        remindersJson: merged.reminders.length ? JSON.stringify(merged.reminders) : null,
        updatedAt: now
      })
    this.rearmRemindersIfRescheduled(existing, merged)
  }

  /** A changed start time or reminder list changes when reminders should fire; clears any
   *  past firing so it can fire again at the new time(s). A pure rename/color/notes
   *  change must not re-notify. */
  private rearmRemindersIfRescheduled(
    before: Pick<EventRecord, 'id' | 'startTs' | 'reminders'>,
    after: { startTs: number; reminders: number[] }
  ): void {
    const remindersChanged = JSON.stringify(after.reminders) !== JSON.stringify(before.reminders)
    if (after.startTs !== before.startTs || remindersChanged) {
      this.db.prepare('DELETE FROM fired_reminders WHERE event_id = ?').run(before.id)
    }
  }

  /** Soft-delete: kept until pushed to Google, then purged by the sync engine. */
  softDelete(id: string): void {
    this.db.prepare('UPDATE events SET deleted_at = ?, dirty = 1 WHERE id = ?').run(this.clock.now(), id)
  }

  purgeDeleted(id: string): void {
    this.db.prepare('DELETE FROM events WHERE id = ?').run(id)
  }

  addException(ex: EventException): void {
    const tx = this.db.transaction((e: EventException) => {
      const prior = this.db
        .prepare('SELECT override_json FROM event_exceptions WHERE event_id = ? AND occurrence_start_ts = ?')
        .get(e.eventId, e.occurrenceStartTs) as { override_json: string | null } | undefined
      const priorStart =
        (prior?.override_json ? (JSON.parse(prior.override_json) as EventException['override']) : undefined)
          ?.startTs ?? e.occurrenceStartTs
      this.db
        .prepare(
          `INSERT INTO event_exceptions (event_id, occurrence_start_ts, kind, override_json, dirty)
           VALUES (@eventId, @occurrenceStartTs, @kind, @overrideJson, 1)
           ON CONFLICT(event_id, occurrence_start_ts)
           DO UPDATE SET kind=excluded.kind, override_json=excluded.override_json, dirty=1`
        )
        .run({
          eventId: e.eventId,
          occurrenceStartTs: e.occurrenceStartTs,
          kind: e.kind,
          overrideJson: e.override ? JSON.stringify(e.override) : null
        })

      // A 'skip' on a Jalali monthly/yearly series is expressed as a Google RDATE list on
      // the parent (there is no real RRULE to attach an EXDATE to), so the parent must be
      // re-pushed whenever such a skip is added. 'override' exceptions are their own Google
      // resource and don't need the parent touched.
      // Moving one occurrence re-arms that occurrence's reminders at its new time.
      if (e.kind === 'override' && (e.override?.startTs ?? e.occurrenceStartTs) !== priorStart) {
        this.db
          .prepare('DELETE FROM fired_reminders WHERE event_id = ? AND occurrence_start_ts = ?')
          .run(e.eventId, e.occurrenceStartTs)
      }

      if (e.kind === 'skip') {
        const parent = this.getById(e.eventId)
        if (parent?.rrule && (parent.rrule.freq === 'monthly' || parent.rrule.freq === 'yearly')) {
          this.db.prepare('UPDATE events SET dirty = 1, updated_at = ? WHERE id = ?').run(this.clock.now(), e.eventId)
        }
      }
    })
    tx(ex)
  }

  listExceptions(eventId: string): EventException[] {
    const rows = this.db.prepare('SELECT * FROM event_exceptions WHERE event_id = ?').all(eventId) as ExceptionRow[]
    return rows.map(rowToException)
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

  // ---- sync ----------------------------------------------------------------

  findByGoogleId(calendarId: string, googleId: string): EventRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM events WHERE calendar_id = ? AND google_id = ?')
      .get(calendarId, googleId) as EventRow | undefined
    return row ? rowToEvent(row) : undefined
  }

  /** Dirty rows, including soft-deleted ones — deletions must be pushed too. */
  listDirty(limit = 500): EventRecord[] {
    const rows = this.db.prepare('SELECT * FROM events WHERE dirty = 1 LIMIT ?').all(limit) as EventRow[]
    return rows.map(rowToEvent)
  }

  /** After a successful push: records identity + etag and clears the dirty flag. */
  markSynced(id: string, sync: MarkSyncedInput): void {
    this.db
      .prepare(
        `UPDATE events SET calendar_id = ?, google_id = ?, etag = ?, remote_updated_at = ?, dirty = 0 WHERE id = ?`
      )
      .run(sync.calendarId, sync.googleId, sync.etag ?? null, sync.remoteUpdatedAt ?? null, id)
  }

  /** Clears dirty without touching identity (a push that turned out to be a no-op). */
  clearDirty(id: string): void {
    this.db.prepare('UPDATE events SET dirty = 0 WHERE id = ?').run(id)
  }

  /**
   * Applies a remote event. Matches on (calendar_id, google_id) first, then adopts an
   * unsynced local row when `adoptLocalId` is supplied, otherwise inserts new. Never
   * resurrects a locally-deleted row unless the remote `updated` is newer than the local
   * deleted_at.
   */
  upsertFromRemote(input: UpsertFromRemoteInput): string {
    const existing = this.findByGoogleId(input.calendarId, input.googleId)
    if (existing) {
      if (existing.deletedAt && (input.remoteUpdatedAt ?? 0) <= existing.deletedAt) {
        return existing.id
      }
      const remoteReminders = normalizeReminders(input.local.reminders ?? [])
      this.db
        .prepare(
          `UPDATE events SET title=@title, notes=@notes, color=@color, start_ts=@startTs, end_ts=@endTs,
           all_day=@allDay, rrule_json=@rruleJson, reminders_json=@remindersJson, etag=@etag,
           remote_updated_at=@remoteUpdatedAt, dirty=0, deleted_at=NULL, updated_at=@updatedAt
           WHERE id=@id`
        )
        .run({
          id: existing.id,
          title: input.local.title,
          notes: input.local.notes ?? null,
          color: input.local.color,
          startTs: input.local.startTs,
          endTs: input.local.endTs,
          allDay: input.local.allDay ? 1 : 0,
          rruleJson: input.local.rrule ? JSON.stringify(input.local.rrule) : null,
          remindersJson: remoteReminders.length ? JSON.stringify(remoteReminders) : null,
          etag: input.etag ?? null,
          remoteUpdatedAt: input.remoteUpdatedAt,
          updatedAt: this.clock.now()
        })
      this.rearmRemindersIfRescheduled(existing, { startTs: input.local.startTs, reminders: remoteReminders })
      return existing.id
    }

    if (input.adoptLocalId) {
      const local = this.getByIdIncludingDeleted(input.adoptLocalId)
      if (local && !local.googleId) {
        this.markSynced(input.adoptLocalId, {
          calendarId: input.calendarId,
          googleId: input.googleId,
          etag: input.etag,
          remoteUpdatedAt: input.remoteUpdatedAt
        })
        return input.adoptLocalId
      }
    }

    const created = this.create(input.local, {
      dirty: false,
      calendarId: input.calendarId,
      googleId: input.googleId,
      etag: input.etag,
      remoteUpdatedAt: input.remoteUpdatedAt
    })
    return created.id
  }

  /** Remote said the event is gone: hard-delete locally, cascading exceptions. */
  deleteByGoogleId(calendarId: string, googleId: string): void {
    this.db.prepare('DELETE FROM events WHERE calendar_id = ? AND google_id = ?').run(calendarId, googleId)
  }

  /** Disconnect: strip every event's Google identity and mark it dirty, so a later
   *  reconnect re-pushes as new rather than PATCHing ids that may belong to another account. */
  clearAllSyncIdentity(): void {
    this.db.exec('UPDATE events SET google_id = NULL, etag = NULL, calendar_id = NULL, dirty = 1')
    this.db.exec('UPDATE event_exceptions SET google_id = NULL, etag = NULL, dirty = 1')
  }

  // ---- exceptions / sync -----------------------------------------------------

  listDirtyExceptions(limit = 500): SyncEventException[] {
    const rows = this.db.prepare('SELECT * FROM event_exceptions WHERE dirty = 1 LIMIT ?').all(limit) as ExceptionRow[]
    return rows.map(rowToException)
  }

  markExceptionSynced(
    eventId: string,
    occurrenceStartTs: number,
    sync: { googleId: string; etag?: string; remoteUpdatedAt?: number }
  ): void {
    this.db
      .prepare(
        `UPDATE event_exceptions SET google_id = ?, etag = ?, remote_updated_at = ?, dirty = 0
         WHERE event_id = ? AND occurrence_start_ts = ?`
      )
      .run(sync.googleId, sync.etag ?? null, sync.remoteUpdatedAt ?? null, eventId, occurrenceStartTs)
  }

  findExceptionByGoogleId(googleId: string): SyncEventException | undefined {
    const row = this.db.prepare('SELECT * FROM event_exceptions WHERE google_id = ?').get(googleId) as
      | ExceptionRow
      | undefined
    return row ? rowToException(row) : undefined
  }

  upsertExceptionFromRemote(input: {
    eventId: string
    occurrenceStartTs: number
    kind: 'skip' | 'override'
    override?: EventException['override']
    googleId: string
    etag?: string
    remoteUpdatedAt?: number
  }): void {
    this.db
      .prepare(
        `INSERT INTO event_exceptions
           (event_id, occurrence_start_ts, kind, override_json, google_id, etag, remote_updated_at, dirty)
         VALUES (@eventId, @occurrenceStartTs, @kind, @overrideJson, @googleId, @etag, @remoteUpdatedAt, 0)
         ON CONFLICT(event_id, occurrence_start_ts) DO UPDATE SET
           kind=excluded.kind, override_json=excluded.override_json, google_id=excluded.google_id,
           etag=excluded.etag, remote_updated_at=excluded.remote_updated_at, dirty=0`
      )
      .run({
        eventId: input.eventId,
        occurrenceStartTs: input.occurrenceStartTs,
        kind: input.kind,
        overrideJson: input.override ? JSON.stringify(input.override) : null,
        googleId: input.googleId,
        etag: input.etag ?? null,
        remoteUpdatedAt: input.remoteUpdatedAt ?? null
      })
  }
}

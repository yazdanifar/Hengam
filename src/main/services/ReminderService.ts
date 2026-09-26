import type Database from 'better-sqlite3'
import type { Clock, Notifier } from '../ports'
import type { EventsRepo } from '../repo/events'
import { formatTimeFromDate } from '@shared/format'
import { formatReminderLead, MAX_REMINDER_MIN } from '@shared/reminders'

const CHECK_INTERVAL_MS = 30_000
const MIN_LOOKAHEAD_MS = 24 * 60 * 60 * 1000
const MAX_LOOKAHEAD_MS = MAX_REMINDER_MIN * 60_000
// A 0-minute ("at start time") reminder is only due once the event has started, so a
// sweep may land up to one check interval after the start. Allow two intervals of slack.
const START_GRACE_MS = 2 * CHECK_INTERVAL_MS

export class ReminderService {
  private timer: unknown

  constructor(
    private db: Database.Database,
    private clock: Clock,
    private notifier: Notifier,
    private events: EventsRepo,
    private onFocusDay?: (ts: number) => void,
    /** Also records each reminder shown, e.g. in the bell's inbox. */
    private onFired?: (r: { title: string; body: string; eventStartTs: number }) => void
  ) {}

  start(): void {
    this.checkOnce()
    this.scheduleNext()
  }

  stop(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
  }

  private scheduleNext(): void {
    this.timer = this.clock.setTimeout(() => {
      this.checkOnce()
      this.scheduleNext()
    }, CHECK_INTERVAL_MS)
  }

  private alreadyFired(eventId: string, occurrenceStartTs: number, minutesBefore: number): boolean {
    return !!this.db
      .prepare(
        'SELECT 1 FROM fired_reminders WHERE event_id = ? AND occurrence_start_ts = ? AND minutes_before = ?'
      )
      .get(eventId, occurrenceStartTs, minutesBefore)
  }

  private markFired(eventId: string, occurrenceStartTs: number, minutesBefore: number): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO fired_reminders (event_id, occurrence_start_ts, minutes_before) VALUES (?, ?, ?)'
      )
      .run(eventId, occurrenceStartTs, minutesBefore)
  }

  /** How far ahead to expand occurrences: far enough to catch the longest lead time any
   *  event currently has, but never less than a day (the old fixed lookahead) nor more
   *  than Google's own 4-week reminder cap. */
  private lookaheadMs(): number {
    const row = this.db
      .prepare(
        `SELECT MAX(je.value) AS maxMin FROM events, json_each(events.reminders_json) je
         WHERE events.reminders_json IS NOT NULL AND events.deleted_at IS NULL`
      )
      .get() as { maxMin: number | null } | undefined
    const maxMin = row?.maxMin ?? 0
    const bounded = Math.min(Math.max(maxMin * 60_000, MIN_LOOKAHEAD_MS), MAX_LOOKAHEAD_MS)
    // rangeQuery's upper bound is exclusive, so a reminder offset landing exactly on it
    // would otherwise be missed; pad past it by one check interval.
    return bounded + CHECK_INTERVAL_MS
  }

  /** Public for tests: runs one reminder sweep immediately. */
  checkOnce(): void {
    const now = this.clock.now()
    const occurrences = this.events.rangeQuery(now, now + this.lookaheadMs())
    for (const occ of occurrences) {
      if (now >= occ.startTs + START_GRACE_MS) continue // don't notify for events that already started
      const reminders = this.eventReminders(occ.eventId)
      const due = reminders.filter((minutesBefore) => {
        if (now < occ.startTs - minutesBefore * 60_000) return false
        return !this.alreadyFired(occ.eventId, occ.occurrenceStartTs, minutesBefore)
      })
      if (due.length === 0) continue
      // Several offsets can become due at once (e.g. the app was closed for a while) —
      // show a single notification for the nearest one rather than a burst of stale ones.
      due.forEach((minutesBefore) => this.markFired(occ.eventId, occ.occurrenceStartTs, minutesBefore))
      const nearest = Math.min(...due)
      // Fired on time: say the offset itself ("10 minutes"). Fired late (app was closed,
      // Mac was asleep, or an edit re-armed an already-passed offset): say the real time left.
      const firedOnTime = now - (occ.startTs - nearest * 60_000) < START_GRACE_MS
      const lead = firedOnTime ? nearest : Math.round((occ.startTs - now) / 60_000)
      const time = formatTimeFromDate(new Date(occ.startTs))
      const body = `${time} — ${formatReminderLead(lead)}`
      this.notifier.show(occ.title, body, () => this.onFocusDay?.(occ.startTs))
      this.onFired?.({ title: occ.title, body, eventStartTs: occ.startTs })
    }
  }

  private eventReminders(eventId: string): number[] {
    const row = this.db.prepare('SELECT reminders_json FROM events WHERE id = ?').get(eventId) as
      | { reminders_json: string | null }
      | undefined
    return row?.reminders_json ? (JSON.parse(row.reminders_json) as number[]) : []
  }
}

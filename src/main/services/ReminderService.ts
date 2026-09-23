import type Database from 'better-sqlite3'
import type { Clock, Notifier } from '../ports'
import type { EventsRepo } from '../repo/events'
import { toFaDigits, formatTimeFromDate } from '@shared/format'

const CHECK_INTERVAL_MS = 30_000
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000

export class ReminderService {
  private timer: unknown

  constructor(
    private db: Database.Database,
    private clock: Clock,
    private notifier: Notifier,
    private events: EventsRepo,
    private onFocusDay?: (ts: number) => void
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

  private alreadyFired(eventId: string, occurrenceStartTs: number): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM fired_reminders WHERE event_id = ? AND occurrence_start_ts = ?')
      .get(eventId, occurrenceStartTs)
  }

  private markFired(eventId: string, occurrenceStartTs: number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO fired_reminders (event_id, occurrence_start_ts) VALUES (?, ?)')
      .run(eventId, occurrenceStartTs)
  }

  /** Public for tests: runs one reminder sweep immediately. */
  checkOnce(): void {
    const now = this.clock.now()
    const occurrences = this.events.rangeQuery(now, now + LOOKAHEAD_MS)
    for (const occ of occurrences) {
      const base = this.eventReminderMin(occ.eventId)
      if (base === undefined) continue
      const fireAt = occ.startTs - base * 60_000
      if (now < fireAt) continue
      if (now >= occ.startTs) continue // don't notify for events that already started
      if (this.alreadyFired(occ.eventId, occ.occurrenceStartTs)) continue
      this.markFired(occ.eventId, occ.occurrenceStartTs)
      const time = formatTimeFromDate(new Date(occ.startTs))
      this.notifier.show(occ.title, `${time} — ${toFaDigits(base)} دقیقه دیگر`, () => this.onFocusDay?.(occ.startTs))
    }
  }

  private eventReminderMin(eventId: string): number | undefined {
    const row = this.db.prepare('SELECT reminder_min FROM events WHERE id = ?').get(eventId) as
      | { reminder_min: number | null }
      | undefined
    return row?.reminder_min ?? undefined
  }
}

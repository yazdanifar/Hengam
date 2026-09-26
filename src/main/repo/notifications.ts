import type Database from 'better-sqlite3'
import type { AlertKind, AppNotification, NotificationKind } from '@shared/notifications'

interface Row {
  id: number
  kind: NotificationKind
  created_at: number
  read_at: number | null
  resolved_at: number | null
  title: string
  body: string | null
  event_start_ts: number | null
  failing_since: number | null
}

// Plenty for a glanceable inbox; older entries are pruned so the table never grows unbounded.
const KEEP_COUNT = 200
const KEEP_MS = 30 * 24 * 60 * 60 * 1000

function toNotification(r: Row): AppNotification {
  return {
    id: r.id,
    kind: r.kind,
    createdAt: r.created_at,
    readAt: r.read_at ?? undefined,
    resolvedAt: r.resolved_at ?? undefined,
    title: r.title,
    body: r.body ?? undefined,
    eventStartTs: r.event_start_ts ?? undefined,
    failingSince: r.failing_since ?? undefined
  }
}

// Every query below that removes or ages out rows spares active alerts (unresolved,
// non-reminder rows): they stay until the problem behind them clears.
const NOT_ACTIVE_ALERT = "(kind = 'reminder' OR resolved_at IS NOT NULL)"

export class NotificationsRepo {
  constructor(private db: Database.Database) {}

  addReminder(input: { title: string; body: string; eventStartTs: number; createdAt: number }): AppNotification {
    const info = this.db
      .prepare(
        `INSERT INTO notifications (kind, created_at, title, body, event_start_ts)
         VALUES ('reminder', ?, ?, ?, ?)`
      )
      .run(input.createdAt, input.title, input.body, input.eventStartTs)
    return this.get(Number(info.lastInsertRowid))!
  }

  addAlert(kind: AlertKind, failingSince: number, createdAt: number): AppNotification {
    const info = this.db
      .prepare(`INSERT INTO notifications (kind, created_at, failing_since) VALUES (?, ?, ?)`)
      .run(kind, createdAt, failingSince)
    return this.get(Number(info.lastInsertRowid))!
  }

  get(id: number): AppNotification | undefined {
    const row = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Row | undefined
    return row && toNotification(row)
  }

  /** Newest first. */
  list(): AppNotification[] {
    const rows = this.db.prepare('SELECT * FROM notifications ORDER BY created_at DESC, id DESC').all() as Row[]
    return rows.map(toNotification)
  }

  activeAlert(kind: AlertKind): AppNotification | undefined {
    const row = this.db
      .prepare('SELECT * FROM notifications WHERE kind = ? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1')
      .get(kind) as Row | undefined
    return row && toNotification(row)
  }

  /** Marks the kind's active alert resolved; returns whether there was one. */
  resolveAlert(kind: AlertKind, at: number): boolean {
    return this.db.prepare('UPDATE notifications SET resolved_at = ? WHERE kind = ? AND resolved_at IS NULL').run(at, kind)
      .changes > 0
  }

  markAllRead(at: number): boolean {
    return this.db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(at).changes > 0
  }

  /** Deletes one entry, unless it's an active alert (those clear only by recovering). */
  dismiss(id: number): boolean {
    return this.db.prepare(`DELETE FROM notifications WHERE id = ? AND ${NOT_ACTIVE_ALERT}`).run(id).changes > 0
  }

  /** Deletes everything except active alerts. */
  clearAll(): boolean {
    return this.db.prepare(`DELETE FROM notifications WHERE ${NOT_ACTIVE_ALERT}`).run().changes > 0
  }

  /** Drops entries older than 30 days, then all but the newest 200. */
  prune(now: number): void {
    this.db.prepare(`DELETE FROM notifications WHERE created_at < ? AND ${NOT_ACTIVE_ALERT}`).run(now - KEEP_MS)
    this.db
      .prepare(
        `DELETE FROM notifications WHERE ${NOT_ACTIVE_ALERT} AND id NOT IN (
           SELECT id FROM notifications ORDER BY created_at DESC, id DESC LIMIT ?
         )`
      )
      .run(KEEP_COUNT)
  }
}

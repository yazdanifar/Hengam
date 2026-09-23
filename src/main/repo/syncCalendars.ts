import type Database from 'better-sqlite3'

export interface SyncCalendar {
  calendarId: string
  summary: string
  color?: string
  enabled: boolean
  syncToken?: string
  isDefaultTarget: boolean
}

interface SyncCalendarRow {
  calendar_id: string
  summary: string
  color: string | null
  enabled: number
  sync_token: string | null
  is_default_target: number
}

function rowToCalendar(row: SyncCalendarRow): SyncCalendar {
  return {
    calendarId: row.calendar_id,
    summary: row.summary,
    color: row.color ?? undefined,
    enabled: !!row.enabled,
    syncToken: row.sync_token ?? undefined,
    isDefaultTarget: !!row.is_default_target
  }
}

export interface RemoteCalendar {
  calendarId: string
  summary: string
  color?: string
  primary?: boolean
}

export class SyncCalendarsRepo {
  constructor(private db: Database.Database) {}

  list(): SyncCalendar[] {
    const rows = this.db.prepare('SELECT * FROM sync_calendars ORDER BY summary').all() as SyncCalendarRow[]
    return rows.map(rowToCalendar)
  }

  listEnabled(): SyncCalendar[] {
    return this.list().filter((c) => c.enabled)
  }

  get(calendarId: string): SyncCalendar | undefined {
    const row = this.db.prepare('SELECT * FROM sync_calendars WHERE calendar_id = ?').get(calendarId) as
      | SyncCalendarRow
      | undefined
    return row ? rowToCalendar(row) : undefined
  }

  /** Upsert from Google's calendarList; preserves local enabled/syncToken/isDefaultTarget
   *  for calendars we already know, and defaults only the primary calendar to enabled. */
  upsertMany(cals: RemoteCalendar[]): void {
    const upsert = this.db.transaction((rows: RemoteCalendar[]) => {
      for (const cal of rows) {
        const existing = this.get(cal.calendarId)
        if (existing) {
          this.db
            .prepare('UPDATE sync_calendars SET summary = ?, color = ? WHERE calendar_id = ?')
            .run(cal.summary, cal.color ?? null, cal.calendarId)
        } else {
          const enabled = cal.primary ? 1 : 0
          this.db
            .prepare(
              `INSERT INTO sync_calendars (calendar_id, summary, color, enabled, is_default_target)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(cal.calendarId, cal.summary, cal.color ?? null, enabled, enabled)
        }
      }
    })
    upsert(cals)
  }

  setEnabled(calendarId: string, enabled: boolean): void {
    this.db.prepare('UPDATE sync_calendars SET enabled = ? WHERE calendar_id = ?').run(enabled ? 1 : 0, calendarId)
  }

  setDefaultTarget(calendarId: string): void {
    const tx = this.db.transaction((id: string) => {
      this.db.prepare('UPDATE sync_calendars SET is_default_target = 0').run()
      this.db.prepare('UPDATE sync_calendars SET is_default_target = 1 WHERE calendar_id = ?').run(id)
    })
    tx(calendarId)
  }

  defaultTarget(): SyncCalendar | undefined {
    const row = this.db.prepare('SELECT * FROM sync_calendars WHERE is_default_target = 1').get() as
      | SyncCalendarRow
      | undefined
    return row ? rowToCalendar(row) : undefined
  }

  setSyncToken(calendarId: string, token: string | undefined): void {
    this.db.prepare('UPDATE sync_calendars SET sync_token = ? WHERE calendar_id = ?').run(token ?? null, calendarId)
  }

  /** Removes rows for calendars Google no longer returns. */
  pruneMissing(keepIds: string[]): void {
    const placeholders = keepIds.map(() => '?').join(',')
    if (keepIds.length === 0) {
      this.db.prepare('DELETE FROM sync_calendars').run()
      return
    }
    this.db.prepare(`DELETE FROM sync_calendars WHERE calendar_id NOT IN (${placeholders})`).run(...keepIds)
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM sync_calendars').run()
  }
}

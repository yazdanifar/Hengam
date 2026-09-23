import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, DEFAULT_EVENT_COLOR } from '@main/db'

describe('migrations', () => {
  it('running migrate twice on the same db changes nothing', () => {
    const db = new Database(':memory:')
    migrate(db)
    const before = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
    migrate(db)
    const after = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
    expect(after).toEqual(before)
  })

  it('lands on user_version 3', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(3)
  })

  it('the events table has no categories table or category_id column left', () => {
    const db = new Database(':memory:')
    migrate(db)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    expect(tables.map((t) => t.name)).not.toContain('categories')
    const columns = db.prepare('PRAGMA table_info(events)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).not.toContain('category_id')
    expect(columns.map((c) => c.name)).toContain('color')
  })

  it('upgrades a v1 database in place, carrying its category color onto the event as a plain color', () => {
    const db = new Database(':memory:')
    // Build a v1-shaped database directly (the exact v1 schema, without later additions),
    // rather than deriving it from a fully-migrated db, so this test still exercises the
    // real upgrade path even after a future migration is appended.
    db.exec(`
      CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL);
      CREATE TABLE events (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL, all_day INTEGER NOT NULL DEFAULT 0,
        rrule_json TEXT, reminder_min INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        calendar_id TEXT, google_id TEXT, etag TEXT, dirty INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER
      );
      CREATE INDEX idx_events_range ON events(start_ts, end_ts);
      CREATE INDEX idx_events_google_id ON events(google_id);
      CREATE TABLE event_exceptions (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        occurrence_start_ts INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('skip','override')),
        override_json TEXT, PRIMARY KEY (event_id, occurrence_start_ts)
      );
      CREATE TABLE tasks (id TEXT PRIMARY KEY, jdate TEXT NOT NULL, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE fired_reminders (event_id TEXT NOT NULL, occurrence_start_ts INTEGER NOT NULL, PRIMARY KEY (event_id, occurrence_start_ts));
      CREATE TABLE sync_calendars (calendar_id TEXT PRIMARY KEY, summary TEXT NOT NULL, color TEXT, enabled INTEGER NOT NULL DEFAULT 1, sync_token TEXT, is_default_target INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    db.pragma('user_version = 1')
    db.prepare('INSERT INTO categories (id, name, color) VALUES (?, ?, ?)').run('work', 'کار', '#3b82f6')
    db.prepare(
      'INSERT INTO events (id, title, category_id, start_ts, end_ts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('ev1', 'Existing event', 'work', 1000, 2000, 1000, 1000)

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(3)
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get('ev1') as {
      title: string
      color: string
      remote_updated_at: unknown
    }
    expect(row.title).toBe('Existing event')
    expect(row.remote_updated_at).toBeNull()
    expect(row.color).toBe('#3b82f6') // carried over from its old category
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    expect(tables.map((t) => t.name)).not.toContain('categories')
  })

  it('the partial unique index rejects duplicate (calendar_id, google_id) but allows many NULLs', () => {
    const db = new Database(':memory:')
    migrate(db)
    const insert = db.prepare(
      `INSERT INTO events (id, title, color, start_ts, end_ts, created_at, updated_at, calendar_id, google_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run('a', 'A', DEFAULT_EVENT_COLOR, 1, 2, 1, 1, null, null)
    insert.run('b', 'B', DEFAULT_EVENT_COLOR, 1, 2, 1, 1, null, null) // two NULL google_id rows: fine
    insert.run('c', 'C', DEFAULT_EVENT_COLOR, 1, 2, 1, 1, 'cal1', 'g1')
    expect(() => insert.run('d', 'D', DEFAULT_EVENT_COLOR, 1, 2, 1, 1, 'cal1', 'g1')).toThrow(/UNIQUE constraint/)
  })
})

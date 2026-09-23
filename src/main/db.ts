import Database from 'better-sqlite3'

export const DEFAULT_EVENT_COLOR = '#3b82f6'

const MIGRATIONS: string[] = [
  // v1: initial schema
  `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  );

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    rrule_json TEXT,
    reminder_min INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    calendar_id TEXT,
    google_id TEXT,
    etag TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    deleted_at INTEGER
  );
  CREATE INDEX idx_events_range ON events(start_ts, end_ts);
  CREATE INDEX idx_events_google_id ON events(google_id);

  CREATE TABLE event_exceptions (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    occurrence_start_ts INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('skip','override')),
    override_json TEXT,
    PRIMARY KEY (event_id, occurrence_start_ts)
  );

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    jdate TEXT NOT NULL,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_tasks_jdate ON tasks(jdate);

  CREATE TABLE fired_reminders (
    event_id TEXT NOT NULL,
    occurrence_start_ts INTEGER NOT NULL,
    PRIMARY KEY (event_id, occurrence_start_ts)
  );

  CREATE TABLE sync_calendars (
    calendar_id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    color TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    sync_token TEXT,
    is_default_target INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2: Google Calendar sync bookkeeping. The unique index is safe only because no
  // existing code path ever wrote a non-NULL google_id, so every pre-existing row has
  // google_id IS NULL and the partial index starts empty.
  `
  CREATE UNIQUE INDEX idx_events_google_uid
    ON events(calendar_id, google_id) WHERE google_id IS NOT NULL;
  CREATE INDEX idx_events_dirty ON events(dirty) WHERE dirty = 1;
  ALTER TABLE events ADD COLUMN remote_updated_at INTEGER;

  ALTER TABLE event_exceptions ADD COLUMN google_id TEXT;
  ALTER TABLE event_exceptions ADD COLUMN etag TEXT;
  ALTER TABLE event_exceptions ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE event_exceptions ADD COLUMN remote_updated_at INTEGER;
  CREATE INDEX idx_exceptions_google_id ON event_exceptions(google_id);

  INSERT OR IGNORE INTO categories (id, name, color) VALUES ('google', 'گوگل', '#4285f4');
  `,
  // v3: drop categories in favor of a plain per-event color, defaulting existing rows to
  // their old category's color so nothing visually jumps on upgrade.
  `
  ALTER TABLE events ADD COLUMN color TEXT NOT NULL DEFAULT '${DEFAULT_EVENT_COLOR}';
  UPDATE events SET color = COALESCE(
    (SELECT color FROM categories WHERE categories.id = events.category_id), '${DEFAULT_EVENT_COLOR}'
  );
  ALTER TABLE events DROP COLUMN category_id;
  DROP TABLE categories;
  `
]

/** Applies every migration the given database is missing, tracked via PRAGMA user_version. */
export function migrate(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const current = db.pragma('user_version', { simple: true }) as number

  const apply = db.transaction(() => {
    for (let v = current; v < MIGRATIONS.length; v++) {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    }
  })
  apply()
}

export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath)
  migrate(db)
  return db
}

export function openInMemoryDatabase(): Database.Database {
  const db = new Database(':memory:')
  migrate(db)
  return db
}

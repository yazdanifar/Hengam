import type Database from 'better-sqlite3'

/** Small key/value store for sync bookkeeping (last-success timestamp, last error, etc). */
export class MetaRepo {
  constructor(private db: Database.Database) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  getNumber(key: string): number | undefined {
    const v = this.get(key)
    return v === undefined ? undefined : Number(v)
  }

  set(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  setNumber(key: string, value: number): void {
    this.set(key, String(value))
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM meta WHERE key = ?').run(key)
  }
}

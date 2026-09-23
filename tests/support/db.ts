import Database from 'better-sqlite3'
import { migrate } from '@main/db'

/**
 * One in-memory database per test file, with every test running inside a
 * transaction that's rolled back afterwards. better-sqlite3's own
 * `db.transaction()` calls become SAVEPOINTs when a transaction is already
 * open, so repo code that uses transactions internally works unchanged.
 */
export function createTestDb() {
  const db = new Database(':memory:')
  migrate(db)
  return db
}

export function withRollback(getDb: () => Database.Database) {
  beforeEach(() => getDb().exec('BEGIN'))
  afterEach(() => getDb().exec('ROLLBACK'))
}

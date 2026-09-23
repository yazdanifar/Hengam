import type Database from 'better-sqlite3'
import type { Category } from '@shared/types'

export class CategoriesRepo {
  constructor(private db: Database.Database) {}

  list(): Category[] {
    return this.db.prepare('SELECT id, name, color FROM categories ORDER BY rowid').all() as Category[]
  }
}

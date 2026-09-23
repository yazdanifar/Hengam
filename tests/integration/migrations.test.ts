import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '@main/db'

describe('migrations', () => {
  it('seeds the default categories exactly once', () => {
    const db = new Database(':memory:')
    migrate(db)
    const rows = db.prepare('SELECT id FROM categories').all() as { id: string }[]
    expect(rows.map((r) => r.id).sort()).toEqual(['family', 'personal', 'sport', 'study', 'work'])
  })

  it('running migrate twice on the same db changes nothing', () => {
    const db = new Database(':memory:')
    migrate(db)
    const before = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
    migrate(db)
    const after = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
    expect(after).toEqual(before)
    const cats = db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number }
    expect(cats.c).toBe(5) // not re-seeded
  })
})

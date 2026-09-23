import { describe, expect, it } from 'vitest'
import { createTestDb, withRollback } from '../support/db'
import { TasksRepo } from '@main/repo/tasks'

describe('TasksRepo', () => {
  const db = createTestDb()
  withRollback(() => db)
  const repo = new TasksRepo(db)

  it('keeps tasks isolated per day', () => {
    repo.create('1405-06-31', 'کار امروز')
    repo.create('1405-07-01', 'کار فردا')
    expect(repo.listForDate('1405-06-31')).toHaveLength(1)
    expect(repo.listForDate('1405-07-01')).toHaveLength(1)
  })

  it('assigns increasing sort order and reorder updates it', () => {
    const a = repo.create('1405-06-31', 'A')
    const b = repo.create('1405-06-31', 'B')
    expect(a.sort).toBe(0)
    expect(b.sort).toBe(1)
    repo.reorder('1405-06-31', [b.id, a.id])
    const list = repo.listForDate('1405-06-31')
    expect(list.map((t) => t.id)).toEqual([b.id, a.id])
  })

  it('toggle and remove', () => {
    const a = repo.create('1405-06-31', 'A')
    repo.toggle(a.id, true)
    expect(repo.listForDate('1405-06-31')[0].done).toBe(true)
    repo.remove(a.id)
    expect(repo.listForDate('1405-06-31')).toHaveLength(0)
  })
})

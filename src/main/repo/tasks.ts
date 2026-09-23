import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Task } from '@shared/types'

interface TaskRow {
  id: string
  jdate: string
  title: string
  done: number
  sort: number
}

function rowToTask(r: TaskRow): Task {
  return { id: r.id, jdate: r.jdate, title: r.title, done: !!r.done, sort: r.sort }
}

export class TasksRepo {
  constructor(private db: Database.Database) {}

  listForDate(jdate: string): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE jdate = ? ORDER BY sort ASC')
      .all(jdate) as TaskRow[]
    return rows.map(rowToTask)
  }

  create(jdate: string, title: string): Task {
    const maxSort = (
      this.db.prepare('SELECT COALESCE(MAX(sort), -1) as m FROM tasks WHERE jdate = ?').get(jdate) as {
        m: number
      }
    ).m
    const task: Task = { id: randomUUID(), jdate, title, done: false, sort: maxSort + 1 }
    this.db
      .prepare('INSERT INTO tasks (id, jdate, title, done, sort) VALUES (@id, @jdate, @title, 0, @sort)')
      .run(task)
    return task
  }

  toggle(id: string, done: boolean): void {
    this.db.prepare('UPDATE tasks SET done = ? WHERE id = ?').run(done ? 1 : 0, id)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  reorder(jdate: string, orderedIds: string[]): void {
    const stmt = this.db.prepare('UPDATE tasks SET sort = ? WHERE id = ? AND jdate = ?')
    const tx = this.db.transaction((ids: string[]) => {
      ids.forEach((id, i) => stmt.run(i, id, jdate))
    })
    tx(orderedIds)
  }
}

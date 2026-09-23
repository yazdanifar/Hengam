import { useEffect, useState } from 'react'
import type { Task } from '@shared/types'
import { jalaliDateKey } from '@shared/jalali'
import { useAppStore } from '../../store'
import { useApi } from '../../apiContext'

export function TaskList() {
  const api = useApi()
  const { selectedDate } = useAppStore()
  const jdate = jalaliDateKey(selectedDate)
  const [tasks, setTasks] = useState<Task[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    api.tasks.listForDate(jdate).then((t) => !cancelled && setTasks(t))
    return () => {
      cancelled = true
    }
  }, [api, jdate])

  async function add() {
    const title = draft.trim()
    if (!title) return
    const t = await api.tasks.create(jdate, title)
    setTasks((prev) => [...prev, t])
    setDraft('')
  }

  async function toggle(t: Task) {
    await api.tasks.toggle(t.id, !t.done)
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))
  }

  async function remove(t: Task) {
    await api.tasks.remove(t.id)
    setTasks((prev) => prev.filter((x) => x.id !== t.id))
  }

  return (
    <div className="task-list">
      <h3>کارهای امروز</h3>
      {tasks.map((t) => (
        <div key={t.id} className={`task-row ${t.done ? 'done' : ''}`}>
          <input type="checkbox" checked={t.done} onChange={() => toggle(t)} id={`task-${t.id}`} />
          <label htmlFor={`task-${t.id}`}>{t.title}</label>
          <button aria-label="حذف" onClick={() => remove(t)} style={{ marginInlineStart: 'auto' }}>
            ×
          </button>
        </div>
      ))}
      <div className="task-add">
        <input
          placeholder="کار جدید…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-primary" onClick={add}>
          +
        </button>
      </div>
    </div>
  )
}

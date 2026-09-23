import { useEffect, useState } from 'react'
import type { Category, EventRecord, RecurrenceRule } from '@shared/types'
import { parseDigits, toFaDigits, pad2 } from '@shared/format'
import { WEEKDAY_LABELS } from '@shared/jalali'
import { useApi } from '../apiContext'

export interface EventDialogResult {
  title: string
  notes?: string
  categoryId: string
  startTs: number
  endTs: number
  allDay: boolean
  rrule?: RecurrenceRule
  reminderMin?: number
}

interface Props {
  initialDate: Date // the slot the user clicked
  existing?: EventRecord
  onClose(): void
  onSave(result: EventDialogResult, scope?: 'this' | 'all'): void
}

function timeStr(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function withTime(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map((s) => parseDigits(s))
  const d = new Date(base)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

export function EventDialog({ initialDate, existing, onClose, onSave }: Props) {
  const api = useApi()
  const [categories, setCategories] = useState<Category[]>([])
  const [title, setTitle] = useState(existing?.title ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '')
  const start = existing ? new Date(existing.startTs) : initialDate
  const end = existing ? new Date(existing.endTs) : new Date(initialDate.getTime() + 3600_000)
  const [startTime, setStartTime] = useState(timeStr(start))
  const [endTime, setEndTime] = useState(timeStr(end))
  const [freq, setFreq] = useState<'' | RecurrenceRule['freq']>(existing?.rrule?.freq ?? '')
  const [byWeekday, setByWeekday] = useState<number[]>(existing?.rrule?.byWeekday ?? [])
  const [reminderMin, setReminderMin] = useState<string>(
    existing?.reminderMin !== undefined ? String(existing.reminderMin) : ''
  )
  const [error, setError] = useState('')

  useEffect(() => {
    api.categories.list().then((cats) => {
      setCategories(cats)
      if (!categoryId && cats[0]) setCategoryId(cats[0].id)
    })
  }, [api])

  function toggleWeekday(i: number) {
    setByWeekday((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i].sort()))
  }

  function submit() {
    if (!title.trim()) {
      setError('عنوان الزامی است')
      return
    }
    const startTs = withTime(start, startTime).getTime()
    const endTs = withTime(end, endTime).getTime()
    if (endTs <= startTs) {
      setError('زمان پایان باید بعد از زمان شروع باشد')
      return
    }
    const rrule: RecurrenceRule | undefined = freq
      ? { freq, interval: 1, byWeekday: freq === 'weekly' && byWeekday.length ? byWeekday : undefined }
      : undefined
    onSave({
      title: title.trim(),
      notes: notes.trim() || undefined,
      categoryId,
      startTs,
      endTs,
      allDay: false,
      rrule,
      reminderMin: reminderMin ? parseDigits(reminderMin) : undefined
    })
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{existing ? 'ویرایش رویداد' : 'رویداد جدید'}</h2>
        <div className="field">
          <label htmlFor="ev-title">عنوان</label>
          <input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="ev-start">شروع</label>
            <input id="ev-start" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ev-end">پایان</label>
            <input id="ev-end" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ev-category">دسته‌بندی</label>
          <select id="ev-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ev-freq">تکرار</label>
          <select id="ev-freq" value={freq} onChange={(e) => setFreq(e.target.value as any)}>
            <option value="">بدون تکرار</option>
            <option value="daily">روزانه</option>
            <option value="weekly">هفتگی</option>
            <option value="monthly">ماهانه</option>
            <option value="yearly">سالانه</option>
          </select>
        </div>
        {freq === 'weekly' && (
          <div className="field">
            <label>روزهای هفته</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {WEEKDAY_LABELS.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  className={byWeekday.includes(i) ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => toggleWeekday(i)}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="ev-reminder">یادآوری (دقیقه قبل)</label>
          <input id="ev-reminder" value={reminderMin} onChange={(e) => setReminderMin(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ev-notes">یادداشت</label>
          <textarea id="ev-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            انصراف
          </button>
          <button className="btn btn-primary" onClick={submit}>
            ذخیره
          </button>
        </div>
      </div>
    </div>
  )
}

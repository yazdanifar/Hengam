import { useState } from 'react'
import type { EventRecord, Occurrence, RecurrenceRule } from '@shared/types'
import { parseDigits, toFaDigits, pad2 } from '@shared/format'
import { WEEKDAY_LABELS } from '@shared/jalali'
import {
  MAX_REMINDERS,
  MAX_REMINDER_MIN,
  REMINDER_UNIT_LABELS,
  splitMinutes,
  toMinutes,
  normalizeReminders,
  type ReminderUnit
} from '@shared/reminders'
import { GOOGLE_EVENT_COLORS, DEFAULT_PICKER_COLOR } from '@shared/colors'
import { useDialogA11y } from '../useDialogA11y'

// In-app swatches of Google's own event colors instead of <input type="color">: Electron's
// native color dialog doesn't open on Windows, and Google can only store these 11 colors.
const DEFAULT_EVENT_COLOR = DEFAULT_PICKER_COLOR
const REMINDER_UNIT_OPTIONS: ReminderUnit[] = ['m', 'h', 'd', 'w']

export interface EventDialogResult {
  title: string
  notes?: string
  color: string
  startTs: number
  endTs: number
  allDay: boolean
  rrule?: RecurrenceRule
  reminders: number[]
}

interface ReminderDraft {
  value: string
  unit: ReminderUnit
}

interface Props {
  initialDate: Date // the slot the user clicked (create), or the clicked occurrence's day (edit)
  existing?: EventRecord
  /** The specific occurrence that was clicked, when editing a recurring event. Its
   *  start/end give the day+time actually shown to the user; `existing.startTs/endTs`
   *  stay the series anchor, used only when the save scope is 'all'. */
  occurrence?: Occurrence
  onClose(): void
  onSave(result: EventDialogResult, scope?: 'this' | 'all'): void
  onDelete?(scope?: 'this' | 'all'): void
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

export function EventDialog({ initialDate, existing, occurrence, onClose, onSave, onDelete }: Props) {
  const { ref, dialogProps, titleId } = useDialogA11y(onClose)
  // What's shown/edited: the clicked occurrence (which carries any per-occurrence
  // override) when there is one, otherwise the event itself, otherwise the clicked slot.
  const shown = occurrence ?? existing
  const [title, setTitle] = useState(shown?.title ?? '')
  const [notes, setNotes] = useState(shown?.notes ?? '')
  const [color, setColor] = useState(shown?.color ?? DEFAULT_EVENT_COLOR)
  const allDay = existing?.allDay ?? false
  const start = shown ? new Date(shown.startTs) : initialDate
  const end = shown ? new Date(shown.endTs) : new Date(initialDate.getTime() + 3600_000)
  const [startTime, setStartTime] = useState(timeStr(start))
  const [endTime, setEndTime] = useState(timeStr(end))
  const [freq, setFreq] = useState<'' | RecurrenceRule['freq']>(existing?.rrule?.freq ?? '')
  const [byWeekday, setByWeekday] = useState<number[]>(existing?.rrule?.byWeekday ?? [])
  const [reminders, setReminders] = useState<ReminderDraft[]>(
    (existing?.reminders ?? []).map((min) => {
      const { value, unit } = splitMinutes(min)
      return { value: String(value), unit }
    })
  )
  const [error, setError] = useState('')
  const [pendingAction, setPendingAction] = useState<'save' | 'delete' | null>(null)

  const isRecurring = !!existing?.rrule

  // Recurrence and reminders live on the series; a "this occurrence only" override can't
  // carry them, so once they're edited only a whole-series save is offered.
  const seriesFieldsChanged =
    !!existing &&
    (freq !== (existing.rrule?.freq ?? '') ||
      JSON.stringify([...byWeekday].sort()) !== JSON.stringify([...(existing.rrule?.byWeekday ?? [])].sort()) ||
      JSON.stringify(
        normalizeReminders(reminders.map((r) => toMinutes(parseDigits(r.value), r.unit)))
      ) !== JSON.stringify(existing.reminders))

  function toggleWeekday(i: number) {
    setByWeekday((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i].sort()))
  }

  function addReminder() {
    setReminders((prev) => (prev.length >= MAX_REMINDERS ? prev : [...prev, { value: '10', unit: 'm' }]))
  }

  function removeReminder(i: number) {
    setReminders((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateReminder(i: number, patch: Partial<ReminderDraft>) {
    setReminders((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  /** Builds the save payload. For scope 'all' the day comes from the series anchor
   *  (existing.startTs), not from whichever occurrence was clicked — otherwise saving
   *  "whole series" from, say, the 5th occurrence would shift the series by 5 days. */
  function buildResult(scope?: 'this' | 'all'): EventDialogResult | null {
    if (!title.trim()) {
      setError('عنوان الزامی است')
      return null
    }
    const startDayBasis = scope === 'all' && existing ? new Date(existing.startTs) : start
    const endDayBasis = scope === 'all' && existing ? new Date(existing.endTs) : end
    const startTs = withTime(startDayBasis, startTime).getTime()
    const endTs = withTime(endDayBasis, endTime).getTime()
    if (endTs <= startTs) {
      setError('زمان پایان باید بعد از زمان شروع باشد')
      return null
    }
    const rrule: RecurrenceRule | undefined = freq
      ? { freq, interval: 1, byWeekday: freq === 'weekly' && byWeekday.length ? byWeekday : undefined }
      : undefined
    const reminderMinutes: number[] = []
    for (const r of reminders) {
      // 0 is valid ("at start time", common on Google events); a blank field is not,
      // even though parseDigits('') is 0.
      const value = parseDigits(r.value)
      const minutes = toMinutes(value, r.unit)
      if (!r.value.trim() || !Number.isInteger(value) || value < 0 || minutes > MAX_REMINDER_MIN) {
        setError('مقدار اعلان نامعتبر است')
        return null
      }
      reminderMinutes.push(minutes)
    }
    return {
      title: title.trim(),
      notes: notes.trim() || undefined,
      color,
      startTs,
      endTs,
      allDay,
      rrule,
      reminders: normalizeReminders(reminderMinutes)
    }
  }

  function submit() {
    if (isRecurring) {
      // Validate now so the error shows immediately, not after picking a scope.
      if (!buildResult('this')) return
      setPendingAction('save')
      return
    }
    const result = buildResult()
    if (result) onSave(result)
  }

  function requestDelete() {
    if (isRecurring) {
      setPendingAction('delete')
      return
    }
    onDelete?.()
  }

  function chooseScope(scope: 'this' | 'all') {
    if (pendingAction === 'delete') {
      onDelete?.(scope)
      return
    }
    const result = buildResult(scope)
    if (result) onSave(result, scope)
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} ref={ref} {...dialogProps}>
        <h2 id={titleId}>{existing ? 'ویرایش رویداد' : 'رویداد جدید'}</h2>
        {existing?.googleId && (
          <div className="settings-note">این رویداد با تقویم گوگل همگام است.</div>
        )}
        {pendingAction ? (
          <div className="field">
            <label>{pendingAction === 'delete' ? 'حذف کدام مورد؟' : 'ذخیره برای کدام مورد؟'}</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-secondary"
                disabled={pendingAction === 'save' && seriesFieldsChanged}
                onClick={() => chooseScope('this')}
              >
                فقط همین مورد
              </button>
              <button className="btn btn-primary" onClick={() => chooseScope('all')}>
                همهٔ موارد
              </button>
            </div>
            {pendingAction === 'save' && seriesFieldsChanged && (
              <div className="settings-note">تغییر تکرار یا اعلان‌ها فقط برای همهٔ موارد اعمال می‌شود.</div>
            )}
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setPendingAction(null)}>
                بازگشت
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="ev-title">عنوان</label>
              <input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="ev-start">شروع</label>
                <input
                  id="ev-start"
                  value={startTime}
                  disabled={allDay}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="ev-end">پایان</label>
                <input id="ev-end" value={endTime} disabled={allDay} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label id="ev-color-label">رنگ</label>
              <div className="color-swatches" role="radiogroup" aria-labelledby="ev-color-label">
                {/* A color not in the palette (e.g. from Google or an older version) stays selectable. */}
                {(GOOGLE_EVENT_COLORS.some((c) => c.hex === color.toLowerCase())
                  ? GOOGLE_EVENT_COLORS
                  : [{ hex: color, label: 'رنگ فعلی' }, ...GOOGLE_EVENT_COLORS]
                ).map((c) => {
                  const selected = c.hex.toLowerCase() === color.toLowerCase()
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={c.label}
                      title={c.label}
                      className={selected ? 'color-swatch selected' : 'color-swatch'}
                      style={{ background: c.hex }}
                      onClick={() => setColor(c.hex)}
                    />
                  )
                })}
              </div>
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
              <label>اعلان‌ها</label>
              {reminders.map((r, i) => (
                <div className="reminder-row" key={i}>
                  <input
                    aria-label="مقدار اعلان"
                    className="reminder-value"
                    inputMode="numeric"
                    value={r.value}
                    onChange={(e) => updateReminder(i, { value: e.target.value })}
                  />
                  <select
                    aria-label="واحد اعلان"
                    className="reminder-unit"
                    value={r.unit}
                    onChange={(e) => updateReminder(i, { unit: e.target.value as ReminderUnit })}
                  >
                    {REMINDER_UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {REMINDER_UNIT_LABELS[u]}
                      </option>
                    ))}
                  </select>
                  <span>قبل</span>
                  <button
                    type="button"
                    aria-label="حذف اعلان"
                    className="reminder-remove"
                    onClick={() => removeReminder(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {reminders.length < MAX_REMINDERS && (
                <button type="button" className="btn btn-secondary reminder-add" onClick={addReminder}>
                  + افزودن اعلان
                </button>
              )}
            </div>
            <div className="field">
              <label htmlFor="ev-notes">یادداشت</label>
              <textarea id="ev-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="dialog-actions">
              {existing && onDelete && (
                <button className="btn btn-danger" onClick={requestDelete} style={{ marginInlineEnd: 'auto' }}>
                  حذف
                </button>
              )}
              <button className="btn btn-secondary" onClick={onClose}>
                انصراف
              </button>
              <button className="btn btn-primary" onClick={submit}>
                ذخیره
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

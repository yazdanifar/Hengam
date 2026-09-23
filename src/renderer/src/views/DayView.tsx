import { useEffect, useMemo, useState } from 'react'
import type { Category, EventRecord, Occurrence } from '@shared/types'
import { useAppStore } from '../store'
import { useApi } from '../apiContext'
import { useHolidays } from '../useHolidays'
import { TimeGrid } from '../components/TimeGrid/TimeGrid'
import { EventDialog, type EventDialogResult } from '../components/EventDialog'

export function DayView() {
  const api = useApi()
  const { selectedDate, selectedGregorian } = useAppStore()
  const holidays = useHolidays(selectedDate.jy)
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [dialog, setDialog] = useState<{ date: Date; existing?: EventRecord } | null>(null)

  const dayStart = useMemo(() => new Date(selectedGregorian).setHours(0, 0, 0, 0), [selectedGregorian])
  const dayEnd = dayStart + 24 * 60 * 60 * 1000

  useEffect(() => {
    api.categories.list().then(setCategories)
  }, [api])

  useEffect(() => {
    api.events.range(dayStart, dayEnd).then(setOccurrences)
  }, [api, dayStart, dayEnd])

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const info = holidays?.get(selectedDate)

  async function handleSave(result: EventDialogResult) {
    await api.events.create(result)
    setDialog(null)
    api.events.range(dayStart, dayEnd).then(setOccurrences)
  }

  return (
    <div className="view-body">
      {info && info.events.length > 0 && (
        <div style={{ padding: '8px 16px', fontSize: 12, color: info.isHoliday ? 'var(--holiday)' : 'var(--text-muted)' }}>
          {info.events.map((e) => e.title).join(' · ')}
        </div>
      )}
      <TimeGrid
        columns={[
          {
            key: 'day',
            dayStartTs: dayStart,
            dayEndTs: dayEnd,
            isHoliday: !!info?.isHoliday,
            isToday: false,
            occurrences
          }
        ]}
        categoriesById={categoriesById}
        onSlotClick={(dayStartTs, hour) => setDialog({ date: new Date(dayStartTs + hour * 3600_000) })}
        onEventClick={() => {}}
      />
      {dialog && (
        <EventDialog initialDate={dialog.date} existing={dialog.existing} onClose={() => setDialog(null)} onSave={handleSave} />
      )}
    </div>
  )
}

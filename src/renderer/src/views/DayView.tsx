import { useEffect, useMemo, useState } from 'react'
import type { Occurrence } from '@shared/types'
import { sameJalaliDate, toJalali } from '@shared/jalali'
import { useAppStore } from '../store'
import { useApi } from '../apiContext'
import { useHolidays } from '../useHolidays'
import { useEventDialog } from '../useEventDialog'
import { TimeGrid } from '../components/TimeGrid/TimeGrid'
import { EventDialog } from '../components/EventDialog'

export function DayView() {
  const api = useApi()
  const { selectedDate, selectedGregorian, dataVersion } = useAppStore()
  const holidays = useHolidays(selectedDate.jy)
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])

  const dayStart = useMemo(() => new Date(selectedGregorian).setHours(0, 0, 0, 0), [selectedGregorian])
  const dayEnd = dayStart + 24 * 60 * 60 * 1000

  const refetch = () => api.events.range(dayStart, dayEnd).then(setOccurrences)
  const { dialog, openCreate, openEdit, close, handleSave, handleDelete } = useEventDialog(refetch)

  useEffect(() => {
    refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, dayStart, dayEnd, dataVersion])

  const info = holidays?.get(selectedDate)
  const isToday = useMemo(() => sameJalaliDate(selectedDate, toJalali(new Date())), [selectedDate])

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
            isToday,
            occurrences
          }
        ]}
        onSlotClick={(dayStartTs, hour) => openCreate(new Date(dayStartTs + hour * 3600_000))}
        onEventClick={openEdit}
      />
      {dialog && (
        <EventDialog
          initialDate={dialog.date}
          existing={dialog.existing}
          occurrence={dialog.occurrence}
          onClose={close}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}

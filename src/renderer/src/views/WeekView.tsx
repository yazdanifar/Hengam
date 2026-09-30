import { useEffect, useMemo, useState } from 'react'
import type { Occurrence } from '@shared/types'
import { WEEKDAY_LABELS, isFriday, sameJalaliDate, startOfJalaliWeek, toJalali } from '@shared/jalali'
import { toFaDigits as digits } from '@shared/format'
import { useAppStore } from '../store'
import { useApi } from '../apiContext'
import { useHolidays } from '../useHolidays'
import { useNowTick } from '../useNowTick'
import { useEventDialog } from '../useEventDialog'
import { TimeGrid } from '../components/TimeGrid/TimeGrid'
import { EventDialog } from '../components/EventDialog'

export function WeekView() {
  const api = useApi()
  const { selectedDate, selectedGregorian, dataVersion } = useAppStore()
  const holidays = useHolidays(selectedDate.jy)
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])

  const weekStart = useMemo(() => startOfJalaliWeek(selectedGregorian), [selectedGregorian])
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * 86400_000), [weekStart])
  const today = toJalali(useNowTick())

  const refetch = () => api.events.range(weekStart.getTime(), weekEnd.getTime()).then(setOccurrences)
  const { dialog, openCreate, openEdit, close, handleSave, handleDelete } = useEventDialog(refetch)

  useEffect(() => {
    refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, weekStart, weekEnd, dataVersion])

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        return d
      }),
    [weekStart]
  )

  const columns = days.map((d) => {
    const dayStartTs = d.getTime()
    const dayEndTs = dayStartTs + 86400_000
    const j = toJalali(d)
    const info = holidays?.get(j)
    return {
      key: dayStartTs.toString(),
      dayStartTs,
      dayEndTs,
      isHoliday: isFriday(d) || !!info?.isHoliday,
      isToday: sameJalaliDate(j, today),
      occurrences: occurrences.filter((o) => o.startTs < dayEndTs && o.endTs > dayStartTs)
    }
  })

  return (
    <div className="view-body">
      <div className="week-header">
        <div className="gutter" />
        {days.map((d, i) => {
          const j = toJalali(d)
          const info = holidays?.get(j)
          const holiday = isFriday(d) || !!info?.isHoliday
          return (
            <div
              key={i}
              className={`day-head ${holiday ? 'holiday' : ''} ${sameJalaliDate(j, today) ? 'today' : ''}`}
            >
              {WEEKDAY_LABELS[i]} {digits(j.jd)}
            </div>
          )
        })}
      </div>
      <TimeGrid
        columns={columns}
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

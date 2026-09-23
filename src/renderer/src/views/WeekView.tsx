import { useEffect, useMemo, useState } from 'react'
import type { Occurrence } from '@shared/types'
import { WEEKDAY_LABELS, isFriday, sameJalaliDate, startOfJalaliWeek, toJalali } from '@shared/jalali'
import { toFaDigits as digits } from '@shared/format'
import { useAppStore } from '../store'
import { useApi } from '../apiContext'
import { useHolidays } from '../useHolidays'
import { TimeGrid } from '../components/TimeGrid/TimeGrid'
import { EventDialog, type EventDialogResult } from '../components/EventDialog'

export function WeekView() {
  const api = useApi()
  const { selectedDate, selectedGregorian, dataVersion } = useAppStore()
  const holidays = useHolidays(selectedDate.jy)
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])
  const [dialog, setDialog] = useState<Date | null>(null)

  const weekStart = useMemo(() => startOfJalaliWeek(selectedGregorian), [selectedGregorian])
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * 86400_000), [weekStart])
  const today = useMemo(() => toJalali(new Date()), [])

  useEffect(() => {
    api.events.range(weekStart.getTime(), weekEnd.getTime()).then(setOccurrences)
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

  async function handleSave(result: EventDialogResult) {
    await api.events.create(result)
    setDialog(null)
    api.events.range(weekStart.getTime(), weekEnd.getTime()).then(setOccurrences)
  }

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
        onSlotClick={(dayStartTs, hour) => setDialog(new Date(dayStartTs + hour * 3600_000))}
        onEventClick={() => {}}
      />
      {dialog && <EventDialog initialDate={dialog} onClose={() => setDialog(null)} onSave={handleSave} />}
    </div>
  )
}

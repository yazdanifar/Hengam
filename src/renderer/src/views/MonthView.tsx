import { useEffect, useMemo, useState } from 'react'
import type { Occurrence } from '@shared/types'
import {
  WEEKDAY_LABELS,
  isFriday,
  monthMatrix,
  sameJalaliDate,
  toGregorian,
  toJalali
} from '@shared/jalali'
import { toFaDigits } from '@shared/format'
import { useAppStore } from '../store'
import { useApi } from '../apiContext'
import { useHolidays } from '../useHolidays'
import { useNowTick } from '../useNowTick'
import { useEventDialog } from '../useEventDialog'
import { EventDialog } from '../components/EventDialog'

const MAX_CHIPS = 3

export function MonthView() {
  const api = useApi()
  const { selectedDate, goto, setView, dataVersion } = useAppStore()
  const holidays = useHolidays(selectedDate.jy)
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])
  const today = toJalali(useNowTick())

  const cells = useMemo(() => monthMatrix(selectedDate.jy, selectedDate.jm), [selectedDate.jy, selectedDate.jm])
  const rangeStart = useMemo(() => toGregorian(cells[0].jy, cells[0].jm, cells[0].jd).getTime(), [cells])
  const rangeEnd = rangeStart + 42 * 86400_000

  const refetch = () => api.events.range(rangeStart, rangeEnd).then(setOccurrences)
  const { dialog, openEdit, close, handleSave, handleDelete } = useEventDialog(refetch)

  useEffect(() => {
    refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, rangeStart, rangeEnd, dataVersion])

  return (
    <div className="view-body">
      <div className="week-header">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="day-head">
            {w}
          </div>
        ))}
      </div>
      <div className="month-grid">
        {cells.map((c, i) => {
          const g = toGregorian(c.jy, c.jm, c.jd)
          const dayStartTs = g.getTime()
          const dayEndTs = dayStartTs + 86400_000
          const info = holidays?.get(c)
          const holiday = isFriday(g) || !!info?.isHoliday
          const dayOccs = occurrences
            .filter((o) => o.startTs < dayEndTs && o.endTs > dayStartTs)
            .sort((a, b) => a.startTs - b.startTs)
          return (
            <div
              key={i}
              className={[
                'month-cell',
                c.jm !== selectedDate.jm ? 'other-month' : '',
                holiday ? 'holiday' : '',
                sameJalaliDate(c, today) ? 'today' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                goto(g)
                setView('day')
              }}
            >
              <div className="day-num">{toFaDigits(c.jd)}</div>
              {dayOccs.slice(0, MAX_CHIPS).map((o) => (
                <div
                  key={`${o.eventId}-${o.occurrenceStartTs}`}
                  className="month-chip"
                  style={{ background: o.color }}
                  onClick={(e) => {
                    e.stopPropagation()
                    openEdit(o)
                  }}
                >
                  {o.title}
                </div>
              ))}
              {dayOccs.length > MAX_CHIPS && (
                <div className="month-more">{toFaDigits(dayOccs.length - MAX_CHIPS)}+ بیشتر</div>
              )}
            </div>
          )
        })}
      </div>
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

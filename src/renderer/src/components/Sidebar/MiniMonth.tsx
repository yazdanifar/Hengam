import { useMemo } from 'react'
import { WEEKDAY_LABELS, monthMatrix, sameJalaliDate, toGregorian, toJalali } from '@shared/jalali'
import { toFaDigits } from '@shared/format'
import { useAppStore } from '../../store'
import { useHolidays } from '../../useHolidays'

export function MiniMonth() {
  const { selectedDate, goto } = useAppStore()
  const cells = useMemo(() => monthMatrix(selectedDate.jy, selectedDate.jm), [selectedDate.jy, selectedDate.jm])
  const holidays = useHolidays(selectedDate.jy)
  const today = useMemo(() => toJalali(new Date()), [])

  return (
    <table className="mini-month">
      <thead>
        <tr>
          {WEEKDAY_LABELS.map((w) => (
            <th key={w}>{w}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 6 }).map((_, row) => (
          <tr key={row}>
            {cells.slice(row * 7, row * 7 + 7).map((c) => {
              const otherMonth = c.jm !== selectedDate.jm
              const info = holidays?.get(c)
              return (
                <td
                  key={`${c.jy}-${c.jm}-${c.jd}`}
                  className={[
                    otherMonth ? 'other-month' : '',
                    info?.isHoliday ? 'holiday' : '',
                    sameJalaliDate(c, today) ? 'today' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => goto(toGregorian(c.jy, c.jm, c.jd))}
                >
                  {toFaDigits(c.jd)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

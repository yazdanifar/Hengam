import { useLayoutEffect, useMemo, useRef } from 'react'
import { toFaDigits } from '@shared/format'
import type { Occurrence } from '@shared/types'
import { layoutOverlaps } from './layoutOverlaps'
import { anchorScrollTop, computeAnchorHour } from './scrollTarget'
import { useNowTick } from '../../useNowTick'

export interface DayColumn {
  key: string
  dayStartTs: number
  dayEndTs: number
  isHoliday: boolean
  isToday: boolean
  occurrences: Occurrence[]
}

interface Props {
  columns: DayColumn[]
  onSlotClick(dayStartTs: number, hour: number): void
  onEventClick(occ: Occurrence): void
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
// Must match .time-gutter .slot / .hour-line { height: 48px } in styles.css.
const HOUR_HEIGHT_PX = 48

export function TimeGrid({ columns, onSlotClick, onEventClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const now = useNowTick()

  const isTodayInView = columns.some((c) => c.isToday)
  const columnsKey = columns.map((c) => c.dayStartTs).join(',')

  const earliestEventHour = useMemo(() => {
    let min: number | undefined
    for (const col of columns) {
      for (const occ of col.occurrences) {
        const hour = (occ.startTs - col.dayStartTs) / 3600_000
        if (min === undefined || hour < min) min = hour
      }
    }
    return min
  }, [columns])

  // Scroll to the useful part of the day/week whenever the view changes to a
  // different day or week — not on every render, and not while the user is
  // scrolling or ticking the clock.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const anchorHour = computeAnchorHour({
      isTodayInView,
      nowHour: now.getHours() + now.getMinutes() / 60,
      earliestEventHour
    })
    el.scrollTop = anchorScrollTop(anchorHour, HOUR_HEIGHT_PX, el.clientHeight)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsKey])

  return (
    <div className="time-grid-scroll" ref={scrollRef}>
      <div className="time-grid">
        <div className="time-gutter">
          {HOURS.map((h) => (
            <div className="slot" key={h}>
              {toFaDigits(h)}:۰۰
            </div>
          ))}
        </div>
        <div className="day-columns">
          {columns.map((col) => {
            const boxes = layoutOverlaps(
              col.occurrences.map((o) => ({ id: `${o.eventId}-${o.occurrenceStartTs}`, startTs: o.startTs, endTs: o.endTs })),
              col.dayStartTs,
              col.dayEndTs
            )
            const boxById = new Map(boxes.map((b) => [b.id, b]))
            const nowPct = col.isToday ? ((now.getTime() - col.dayStartTs) / (col.dayEndTs - col.dayStartTs)) * 100 : null
            return (
              <div key={col.key} className={`day-col ${col.isHoliday ? 'holiday' : ''}`}>
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="hour-line"
                    onClick={() => onSlotClick(col.dayStartTs, h)}
                    data-testid="hour-slot"
                  />
                ))}
                {nowPct !== null && nowPct >= 0 && nowPct <= 100 && (
                  <div className="now-line" style={{ top: `${nowPct}%` }} data-testid="now-line" />
                )}
                {col.occurrences.map((occ) => {
                  const id = `${occ.eventId}-${occ.occurrenceStartTs}`
                  const box = boxById.get(id)
                  if (!box) return null
                  const color = occ.color
                  return (
                    <div
                      key={id}
                      className="event-box"
                      style={{
                        top: `${box.topPct}%`,
                        height: `${Math.max(box.heightPct, 2)}%`,
                        right: `${box.rightPct}%`,
                        width: `calc(${box.widthPct}% - 2px)`,
                        background: color
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onEventClick(occ)
                      }}
                    >
                      {occ.title}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

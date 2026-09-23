import { toFaDigits } from '@shared/format'
import type { Occurrence } from '@shared/types'
import type { Category } from '@shared/types'
import { layoutOverlaps } from './layoutOverlaps'

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
  categoriesById: Map<string, Category>
  onSlotClick(dayStartTs: number, hour: number): void
  onEventClick(occ: Occurrence): void
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export function TimeGrid({ columns, categoriesById, onSlotClick, onEventClick }: Props) {
  return (
    <div className="time-grid">
      <div className="time-gutter">
        <div className="slot" />
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
              {col.occurrences.map((occ) => {
                const id = `${occ.eventId}-${occ.occurrenceStartTs}`
                const box = boxById.get(id)
                if (!box) return null
                const color = categoriesById.get(occ.categoryId)?.color ?? '#888'
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
  )
}

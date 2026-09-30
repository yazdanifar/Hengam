export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface RecurrenceRule {
  freq: RecurrenceFreq
  interval: number // every N units
  byWeekday?: number[] // 0=Saturday..6=Friday, only for 'weekly'
  until?: number // epoch ms, inclusive
  count?: number
}

export interface EventRecord {
  id: string
  title: string
  notes?: string
  color: string
  startTs: number // epoch ms
  endTs: number // epoch ms
  allDay: boolean
  rrule?: RecurrenceRule
  /** Minutes before the start each notification fires. Sorted ascending, no duplicates,
   *  empty when the event has no reminders. */
  reminders: number[]
  createdAt: number
  updatedAt: number
  // sync bookkeeping (Google Calendar) — present even before sync ships, per the DI/testability plan
  calendarId?: string
  googleId?: string
  etag?: string
  dirty: boolean
  deletedAt?: number
  /** Bumped on every local content change; lets a push that's in flight tell whether the
   *  row it read is still the row on disk before marking it clean. */
  editSeq: number
}

export type ExceptionKind = 'skip' | 'override'

export interface EventException {
  eventId: string
  occurrenceStartTs: number
  kind: ExceptionKind
  override?: Partial<Pick<EventRecord, 'title' | 'notes' | 'startTs' | 'endTs' | 'color'>>
}

/** A single occurrence of an event, after recurrence expansion, ready to render. */
export interface Occurrence {
  eventId: string
  occurrenceStartTs: number // the original (un-overridden) slot, used as the exception key
  title: string
  notes?: string
  color: string
  startTs: number
  endTs: number
  allDay: boolean
  isRecurring: boolean
}

export interface HolidayEvent {
  title: string
  isHoliday: boolean
}

export interface DayInfo {
  isHoliday: boolean
  events: HolidayEvent[]
  incomplete?: boolean
}

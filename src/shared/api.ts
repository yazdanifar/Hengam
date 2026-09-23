// The single contract between the renderer and the main process. The preload
// script implements this over IPC; tests implement it with an in-memory FakeApi.
import type { DayInfo, EventException, EventRecord, Occurrence, Task } from './types'
import type { MainToRendererEvents, SyncCalendarDto, SyncStatus } from './events'

export interface CreateEventInput {
  title: string
  notes?: string
  color: string
  startTs: number
  endTs: number
  allDay: boolean
  rrule?: EventRecord['rrule']
  reminderMin?: number
}

export type UpdateEventInput = Partial<CreateEventInput> & {
  id: string
  /** When editing a recurring event: apply to just this occurrence or the whole series. */
  scope?: 'this' | 'all'
  occurrenceStartTs?: number
}

export interface HengamApi {
  events: {
    range(startTs: number, endTs: number): Promise<Occurrence[]>
    create(input: CreateEventInput): Promise<EventRecord>
    update(input: UpdateEventInput): Promise<void>
    remove(id: string, scope?: 'this' | 'all', occurrenceStartTs?: number): Promise<void>
    listExceptions(eventId: string): Promise<EventException[]>
  }
  tasks: {
    listForDate(jdate: string): Promise<Task[]>
    create(jdate: string, title: string): Promise<Task>
    toggle(id: string, done: boolean): Promise<void>
    remove(id: string): Promise<void>
    reorder(jdate: string, orderedIds: string[]): Promise<void>
  }
  holidays: {
    year(jy: number): Promise<{ jm: number; jd: number; info: DayInfo }[]>
  }
  google: {
    status(): Promise<SyncStatus>
    connect(): Promise<SyncStatus>
    cancelConnect(): Promise<void>
    disconnect(): Promise<SyncStatus>
    syncNow(): Promise<SyncStatus>
    listCalendars(): Promise<SyncCalendarDto[]>
    refreshCalendars(): Promise<SyncCalendarDto[]>
    setCalendarEnabled(calendarId: string, enabled: boolean): Promise<void>
    setDefaultTarget(calendarId: string): Promise<void>
    onStatus(cb: (s: SyncStatus) => void): () => void
    onEventsChanged(cb: (p: MainToRendererEvents['events:changed']) => void): () => void
  }
}

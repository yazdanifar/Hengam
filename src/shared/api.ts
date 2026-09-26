// The single contract between the renderer and the main process. The preload
// script implements this over IPC; tests implement it with an in-memory FakeApi.
import type { DayInfo, EventException, EventRecord, Occurrence } from './types'
import type { HolidayStatus, MainToRendererEvents, SettingsSection, SyncCalendarDto, SyncStatus } from './events'
import type { AlertSettings, AppNotification } from './notifications'

export interface CreateEventInput {
  title: string
  notes?: string
  color: string
  startTs: number
  endTs: number
  allDay: boolean
  rrule?: EventRecord['rrule']
  reminders?: number[]
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
    get(id: string): Promise<EventRecord | undefined>
    create(input: CreateEventInput): Promise<EventRecord>
    update(input: UpdateEventInput): Promise<void>
    remove(id: string, scope?: 'this' | 'all', occurrenceStartTs?: number): Promise<void>
    listExceptions(eventId: string): Promise<EventException[]>
  }
  holidays: {
    year(jy: number): Promise<{ jm: number; jd: number; info: DayInfo }[]>
    status(): Promise<HolidayStatus>
    /** Fetches now, outside the daily schedule. Resolves with the resulting status. */
    refreshNow(): Promise<HolidayStatus>
    onStatus(cb: (s: HolidayStatus) => void): () => void
    onChanged(cb: (p: MainToRendererEvents['holidays:changed']) => void): () => void
  }
  notifications: {
    /** Newest first. */
    list(): Promise<AppNotification[]>
    markAllRead(): Promise<void>
    /** Removes one entry; active alerts can't be dismissed, only resolved by recovery. */
    dismiss(id: number): Promise<void>
    /** Removes everything except active alerts. */
    clearAll(): Promise<void>
    onChanged(cb: (p: MainToRendererEvents['notifications:changed']) => void): () => void
  }
  settings: {
    getAlerts(): Promise<AlertSettings>
    /** Invalid values are ignored; resolves with the settings actually stored. */
    setAlerts(patch: Partial<AlertSettings>): Promise<AlertSettings>
    onOpenRequest(cb: (section: SettingsSection) => void): () => void
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

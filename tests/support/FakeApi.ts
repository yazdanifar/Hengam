import type { HengamApi } from '@shared/api'
import type { HolidayStatus, SettingsSection, SyncCalendarDto, SyncStatus } from '@shared/events'
import type { EventException, EventRecord, Occurrence } from '@shared/types'
import { DEFAULT_ALERT_SETTINGS, type AlertSettings, type AppNotification } from '@shared/notifications'

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

const DEFAULT_STATUS: SyncStatus = { phase: 'disabled', connected: false, configured: false }

type Listeners<T> = ((p: T) => void)[]

function channel<T>() {
  let listeners: Listeners<T> = []
  return {
    subscribe(cb: (p: T) => void): () => void {
      listeners.push(cb)
      return () => (listeners = listeners.filter((c) => c !== cb))
    },
    emit(p: T): void {
      listeners.forEach((cb) => cb(p))
    },
    get count(): number {
      return listeners.length
    }
  }
}

/** In-memory HengamApi for component tests — the FakeApi that src/shared/api.ts has
 *  always promised exists. Backed by plain arrays/values; the `emit*` helpers drive the
 *  push-channel subscriptions the way main would over IPC, and `notifications` behaves
 *  like main's inbox (mark-read, dismiss, clear), announcing each change on its channel. */
export function createFakeApi(
  overrides: DeepPartial<HengamApi> = {},
  seed: { notifications?: AppNotification[]; holidayStatus?: HolidayStatus; alerts?: AlertSettings } = {}
) {
  const statusCh = channel<SyncStatus>()
  const eventsChangedCh = channel<{ changedAt: number }>()
  const holidayStatusCh = channel<HolidayStatus>()
  const holidaysChangedCh = channel<{ changedAt: number }>()
  const notificationsCh = channel<{ changedAt: number }>()
  const openSettingsCh = channel<SettingsSection>()

  let status: SyncStatus = { ...DEFAULT_STATUS }
  let calendars: SyncCalendarDto[] = []
  let holidayStatus: HolidayStatus = seed.holidayStatus ?? { phase: 'idle' }
  let notifications: AppNotification[] = seed.notifications ?? []
  let alerts: AlertSettings = seed.alerts ?? { ...DEFAULT_ALERT_SETTINGS }

  const notificationsChanged = () => notificationsCh.emit({ changedAt: Date.now() })

  const base: HengamApi = {
    events: {
      range: async (): Promise<Occurrence[]> => [],
      get: async (): Promise<EventRecord | undefined> => undefined,
      create: async (input): Promise<EventRecord> => ({
        id: 'fake-id',
        dirty: true,
        createdAt: 0,
        updatedAt: 0,
        reminders: [],
        ...input
      }),
      update: async () => {},
      remove: async () => {},
      listExceptions: async (): Promise<EventException[]> => []
    },
    holidays: {
      year: async () => [],
      status: async () => holidayStatus,
      refreshNow: async () => holidayStatus,
      onStatus: holidayStatusCh.subscribe,
      onChanged: holidaysChangedCh.subscribe
    },
    notifications: {
      list: async () => notifications,
      markAllRead: async () => {
        notifications = notifications.map((n) => (n.readAt === undefined ? { ...n, readAt: 1 } : n))
        notificationsChanged()
      },
      dismiss: async (id) => {
        notifications = notifications.filter((n) => n.id !== id)
        notificationsChanged()
      },
      clearAll: async () => {
        notifications = notifications.filter((n) => n.kind !== 'reminder' && n.resolvedAt === undefined)
        notificationsChanged()
      },
      onChanged: notificationsCh.subscribe
    },
    settings: {
      getAlerts: async () => alerts,
      setAlerts: async (patch) => {
        alerts = { ...alerts, ...patch }
        return alerts
      },
      onOpenRequest: openSettingsCh.subscribe
    },
    google: {
      status: async () => status,
      connect: async () => {
        status = { ...status, connected: true, phase: 'idle' }
        return status
      },
      cancelConnect: async () => {},
      disconnect: async () => {
        status = { ...status, connected: false, phase: 'idle' }
        return status
      },
      syncNow: async () => status,
      listCalendars: async () => calendars,
      refreshCalendars: async () => calendars,
      setCalendarEnabled: async (calendarId, enabled) => {
        calendars = calendars.map((c) => (c.calendarId === calendarId ? { ...c, enabled } : c))
      },
      setDefaultTarget: async (calendarId) => {
        calendars = calendars.map((c) => ({ ...c, isDefaultTarget: c.calendarId === calendarId }))
      },
      onStatus: statusCh.subscribe,
      onEventsChanged: eventsChangedCh.subscribe
    }
  }

  const merged = mergeDeep(base, overrides) as HengamApi

  return {
    ...merged,
    emitSyncStatus: (s: SyncStatus) => {
      status = s
      statusCh.emit(s)
    },
    emitEventsChanged: (p: { changedAt: number }) => eventsChangedCh.emit(p),
    emitHolidayStatus: (s: HolidayStatus) => {
      holidayStatus = s
      holidayStatusCh.emit(s)
    },
    emitHolidaysChanged: () => holidaysChangedCh.emit({ changedAt: Date.now() }),
    /** Replaces the inbox (as if main added/resolved entries) and announces the change. */
    setNotifications: (items: AppNotification[]) => {
      notifications = items
      notificationsChanged()
    },
    getNotifications: () => notifications,
    getAlerts: () => alerts,
    requestOpenSettings: (section: SettingsSection) => openSettingsCh.emit(section),
    /** How many push-channel subscriptions are live, to check cleanup on unmount. */
    subscriptionCount: () =>
      statusCh.count +
      eventsChangedCh.count +
      holidayStatusCh.count +
      holidaysChangedCh.count +
      notificationsCh.count +
      openSettingsCh.count
  }
}

export type FakeApi = ReturnType<typeof createFakeApi>

function mergeDeep<T>(base: T, overrides: DeepPartial<T>): T {
  const out: any = { ...base }
  for (const key of Object.keys(overrides ?? {})) {
    const overrideValue = (overrides as any)[key]
    const baseValue = (base as any)[key]
    out[key] =
      overrideValue && typeof overrideValue === 'object' && !Array.isArray(overrideValue) && baseValue
        ? mergeDeep(baseValue, overrideValue)
        : overrideValue
  }
  return out
}

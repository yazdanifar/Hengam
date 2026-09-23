import type { HengamApi } from '@shared/api'
import type { SyncCalendarDto, SyncStatus } from '@shared/events'
import type { EventException, EventRecord, Occurrence, Task } from '@shared/types'

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

const DEFAULT_STATUS: SyncStatus = { phase: 'disabled', connected: false, configured: false }

/** In-memory HengamApi for component tests — the FakeApi that src/shared/api.ts has
 *  always promised exists. Backed by plain arrays/values; `emitSyncStatus`/`emitEventsChanged`
 *  drive the push-channel subscriptions the way main would over IPC. */
export function createFakeApi(overrides: DeepPartial<HengamApi> = {}): HengamApi & {
  emitSyncStatus(s: SyncStatus): void
  emitEventsChanged(p: { changedAt: number }): void
} {
  let statusListeners: ((s: SyncStatus) => void)[] = []
  let changedListeners: ((p: { changedAt: number }) => void)[] = []
  let status: SyncStatus = { ...DEFAULT_STATUS }
  let calendars: SyncCalendarDto[] = []

  const base: HengamApi = {
    events: {
      range: async (): Promise<Occurrence[]> => [],
      create: async (input): Promise<EventRecord> => ({
        id: 'fake-id',
        dirty: true,
        createdAt: 0,
        updatedAt: 0,
        ...input
      }),
      update: async () => {},
      remove: async () => {},
      listExceptions: async (): Promise<EventException[]> => []
    },
    tasks: {
      listForDate: async (): Promise<Task[]> => [],
      create: async (jdate, title): Promise<Task> => ({ id: 'task-1', jdate, title, done: false, sort: 0 }),
      toggle: async () => {},
      remove: async () => {},
      reorder: async () => {}
    },
    holidays: {
      year: async () => []
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
      onStatus: (cb) => {
        statusListeners.push(cb)
        return () => (statusListeners = statusListeners.filter((c) => c !== cb))
      },
      onEventsChanged: (cb) => {
        changedListeners.push(cb)
        return () => (changedListeners = changedListeners.filter((c) => c !== cb))
      }
    }
  }

  const merged = mergeDeep(base, overrides) as HengamApi

  return {
    ...merged,
    emitSyncStatus: (s: SyncStatus) => {
      status = s
      statusListeners.forEach((cb) => cb(s))
    },
    emitEventsChanged: (p: { changedAt: number }) => changedListeners.forEach((cb) => cb(p))
  }
}

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

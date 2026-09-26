import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Container } from '@main/container'

const handlers = new Map<string, (...args: any[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn) }
}))

const { registerIpc } = await import('@main/ipc')

/** Invokes a registered handler the way ipcRenderer.invoke would (event object first). */
const invoke = (channel: string, ...args: unknown[]) => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return fn({}, ...args)
}

function fakeContainer() {
  const calendar = { calendarId: 'c1', summary: 'Me', color: '#fff', enabled: true, isDefaultTarget: true, syncToken: 'x' }
  return {
    clock: { now: () => new Date('2026-09-24T09:00:00').getTime() },
    refreshTray: vi.fn(),
    events: {
      rangeQuery: vi.fn(() => ['occ']),
      getById: vi.fn(() => 'event'),
      create: vi.fn(() => 'created'),
      update: vi.fn(),
      addException: vi.fn(),
      softDelete: vi.fn(),
      listExceptions: vi.fn(() => ['ex'])
    },
    holidays: {
      getYear: vi.fn(() => undefined),
      getStatus: vi.fn(() => ({ phase: 'idle' })),
      refreshNow: vi.fn(async () => ({ phase: 'idle', lastSuccessAt: 1 }))
    },
    notifications: {
      list: vi.fn(() => ['n']),
      markAllRead: vi.fn(),
      dismiss: vi.fn(),
      clearAll: vi.fn()
    },
    alertSettings: {
      get: vi.fn(() => ({ syncFailureMin: 720, holidayFailureMin: 4320 })),
      set: vi.fn((patch) => ({ syncFailureMin: 720, holidayFailureMin: 4320, ...patch }))
    },
    alerts: { evaluate: vi.fn() },
    sync: {
      getStatus: vi.fn(() => 'status'),
      connect: vi.fn(() => 'connected'),
      cancelConnect: vi.fn(),
      disconnect: vi.fn(() => 'disconnected'),
      syncNow: vi.fn((): unknown => 'synced'),
      refreshCalendars: vi.fn(async () => [calendar]),
      setCalendarEnabled: vi.fn(),
      setDefaultTarget: vi.fn()
    },
    syncCalendars: { list: vi.fn(() => [calendar]) }
  }
}

let c: ReturnType<typeof fakeContainer>

beforeEach(() => {
  handlers.clear()
  c = fakeContainer()
  registerIpc(c as unknown as Container)
})

describe('ipc — events', () => {
  it('reads go straight to the repo', () => {
    expect(invoke('events:range', 1, 2)).toEqual(['occ'])
    expect(c.events.rangeQuery).toHaveBeenCalledWith(1, 2)
    expect(invoke('events:get', 'e1')).toBe('event')
    expect(invoke('events:listExceptions', 'e1')).toEqual(['ex'])
  })

  it('every mutation refreshes the tray and kicks off a background sync', () => {
    expect(invoke('events:create', { title: 't' })).toBe('created')
    invoke('events:update', { id: 'e1', title: 'u' })
    expect(c.events.update).toHaveBeenCalledWith('e1', { id: 'e1', title: 'u' })
    invoke('events:remove', 'e1')
    expect(c.events.softDelete).toHaveBeenCalledWith('e1')
    expect(c.refreshTray).toHaveBeenCalledTimes(3)
    expect(c.sync.syncNow).toHaveBeenCalledTimes(3)
    expect(c.sync.syncNow).toHaveBeenCalledWith('local-change')
  })

  it('does not wait for the background sync before returning — a slow sync never blocks the save', async () => {
    let releaseSync!: () => void
    c.sync.syncNow.mockReturnValue(new Promise((resolve) => (releaseSync = () => resolve('synced'))))
    const created = invoke('events:create', { title: 't' })
    // The handler already returned (it's not even a Promise here), while the sync it
    // triggered is still pending — proving the two are not sequenced.
    expect(created).toBe('created')
    expect(c.sync.syncNow).toHaveBeenCalledWith('local-change')
    releaseSync()
  })

  it('"this occurrence" edits and deletes become exceptions', () => {
    invoke('events:update', { id: 'e1', scope: 'this', occurrenceStartTs: 9, title: 'x', startTs: 1, endTs: 2 })
    expect(c.events.addException).toHaveBeenCalledWith({
      eventId: 'e1',
      occurrenceStartTs: 9,
      kind: 'override',
      override: { title: 'x', notes: undefined, color: undefined, startTs: 1, endTs: 2 }
    })
    invoke('events:remove', 'e1', 'this', 9)
    expect(c.events.addException).toHaveBeenLastCalledWith({ eventId: 'e1', occurrenceStartTs: 9, kind: 'skip' })
    expect(c.events.softDelete).not.toHaveBeenCalled()
  })
})

describe('ipc — holidays', () => {
  it('year returns every day of the year without touching the network', () => {
    const rows = invoke('holidays:year', 1405) as { jm: number; jd: number }[]
    expect(rows).toHaveLength(365)
    expect(rows[0]).toMatchObject({ jm: 1, jd: 1, info: { isHoliday: true } })
    expect(c.holidays.refreshNow).not.toHaveBeenCalled()
  })

  it('status and refreshNow delegate to the service', async () => {
    expect(invoke('holidays:status')).toEqual({ phase: 'idle' })
    await expect(invoke('holidays:refreshNow')).resolves.toEqual({ phase: 'idle', lastSuccessAt: 1 })
  })
})

describe('ipc — notifications and settings', () => {
  it('inbox operations delegate to the notification center', () => {
    expect(invoke('notifications:list')).toEqual(['n'])
    invoke('notifications:markAllRead')
    invoke('notifications:dismiss', 7)
    invoke('notifications:clearAll')
    expect(c.notifications.markAllRead).toHaveBeenCalled()
    expect(c.notifications.dismiss).toHaveBeenCalledWith(7)
    expect(c.notifications.clearAll).toHaveBeenCalled()
  })

  it('saving a threshold stores it and re-checks alerts straight away', () => {
    expect(invoke('settings:getAlerts')).toEqual({ syncFailureMin: 720, holidayFailureMin: 4320 })
    expect(invoke('settings:setAlerts', { syncFailureMin: 60 })).toEqual({ syncFailureMin: 60, holidayFailureMin: 4320 })
    expect(c.alertSettings.set).toHaveBeenCalledWith({ syncFailureMin: 60 })
    expect(c.alerts.evaluate).toHaveBeenCalledTimes(1)
  })
})

describe('ipc — google', () => {
  it('delegates to the sync service and maps calendars to DTOs', async () => {
    expect(invoke('google:status')).toBe('status')
    expect(invoke('google:connect')).toBe('connected')
    invoke('google:cancelConnect')
    expect(invoke('google:disconnect')).toBe('disconnected')
    expect(invoke('google:syncNow')).toBe('synced')
    expect(c.sync.syncNow).toHaveBeenCalledWith('manual')

    const dto = { calendarId: 'c1', summary: 'Me', color: '#fff', enabled: true, isDefaultTarget: true }
    expect(invoke('google:listCalendars')).toEqual([dto])
    await expect(invoke('google:refreshCalendars')).resolves.toEqual([dto])

    invoke('google:setCalendarEnabled', 'c1', false)
    invoke('google:setDefaultTarget', 'c1')
    expect(c.sync.setCalendarEnabled).toHaveBeenCalledWith('c1', false)
    expect(c.sync.setDefaultTarget).toHaveBeenCalledWith('c1')
    expect(c.sync.cancelConnect).toHaveBeenCalled()
  })
})

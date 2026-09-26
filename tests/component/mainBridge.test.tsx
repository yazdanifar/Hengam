// The renderer's single subscriber to main's push channels (useMainBridge), and the
// holiday cache it invalidates — exercised through the real App.
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { createFakeApi } from '../support/FakeApi'
import { renderApp, resetRendererStores } from '../support/renderApp'
import { useSyncStore } from '@renderer/syncStore'
import { useNotificationStore } from '@renderer/notificationStore'
import { useAppStore } from '@renderer/store'
import { ApiProvider } from '@renderer/apiContext'
import { useHolidays } from '@renderer/useHolidays'
import type { AppNotification } from '@shared/notifications'
import type { SyncStatus } from '@shared/events'

const reminder: AppNotification = { id: 1, kind: 'reminder', createdAt: Date.now(), title: 'جلسه', body: 'b' }

beforeEach(() => {
  resetRendererStores()
})

describe('useMainBridge', () => {
  it('pulls sync status, holiday status and the inbox on mount', async () => {
    const api = createFakeApi({}, { notifications: [reminder], holidayStatus: { phase: 'error', failingSince: 5 } })
    api.emitSyncStatus({ phase: 'idle', connected: true, configured: true })
    renderApp(api)
    await waitFor(() => {
      expect(useSyncStore.getState().status.connected).toBe(true)
      expect(useSyncStore.getState().holidayStatus).toEqual({ phase: 'error', failingSince: 5 })
      expect(useNotificationStore.getState().items).toEqual([reminder])
    })
  })

  it('keeps the stores current from pushes', async () => {
    const api = createFakeApi()
    renderApp(api)
    await waitFor(() => expect(api.subscriptionCount()).toBe(6))

    const status: SyncStatus = { phase: 'syncing', connected: true, configured: true }
    act(() => api.emitSyncStatus(status))
    act(() => api.emitHolidayStatus({ phase: 'refreshing' }))
    act(() => api.setNotifications([reminder]))
    expect(useSyncStore.getState().status).toBe(status)
    expect(useSyncStore.getState().holidayStatus.phase).toBe('refreshing')
    await waitFor(() => expect(useNotificationStore.getState().items).toEqual([reminder]))
  })

  it('an events change bumps dataVersion so open views refetch', async () => {
    const api = createFakeApi()
    renderApp(api)
    await waitFor(() => expect(api.subscriptionCount()).toBe(6))
    const before = useAppStore.getState().dataVersion
    act(() => api.emitEventsChanged({ changedAt: 1 }))
    expect(useAppStore.getState().dataVersion).toBe(before + 1)
  })

  it('a holidays change drops the cached years and refetches them, so corrected dates show without a restart', async () => {
    const years: number[] = []
    const api = createFakeApi({
      holidays: {
        year: async (jy: number) => {
          years.push(jy)
          return []
        }
      }
    })
    renderApp(api)
    await waitFor(() => expect(years.length).toBeGreaterThan(0))
    const fetchedOnMount = new Set(years)
    years.length = 0

    act(() => api.emitHolidaysChanged())
    await waitFor(() => expect(new Set(years)).toEqual(fetchedOnMount))
  })

  it("main's request to open settings opens the dialog on that tab", async () => {
    const api = createFakeApi()
    renderApp(api)
    await waitFor(() => expect(api.subscriptionCount()).toBe(6))
    act(() => api.requestOpenSettings('holidays'))
    const dialog = screen.getByRole('dialog', { name: 'تنظیمات' })
    expect(within(dialog).getByRole('tab', { name: /تعطیلات رسمی/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('unsubscribes everything on unmount, and ignores answers that arrive afterwards', async () => {
    let answer!: (s: SyncStatus) => void
    const api = createFakeApi({ google: { status: () => new Promise<SyncStatus>((r) => (answer = r)) } })
    const { unmount } = renderApp(api)
    await waitFor(() => expect(api.subscriptionCount()).toBe(6))
    unmount()
    expect(api.subscriptionCount()).toBe(0)

    await act(async () => answer({ phase: 'idle', connected: true, configured: true }))
    expect(useSyncStore.getState().status.connected).toBe(false)
  })
})

describe('useHolidays', () => {
  function Probe({ jy }: { jy: number }) {
    const lookup = useHolidays(jy)
    const info = lookup?.get({ jm: 1, jd: 1 })
    return <div>{lookup ? (info?.isHoliday ? 'holiday' : 'workday') : 'loading'}</div>
  }

  it('loads a year once and serves it from memory afterwards', async () => {
    let calls = 0
    const api = createFakeApi({
      holidays: {
        year: async () => {
          calls++
          return [{ jm: 1, jd: 1, info: { isHoliday: true, events: [] } }]
        }
      }
    })
    const first = render(
      <ApiProvider api={api}>
        <Probe jy={1405} />
      </ApiProvider>
    )
    expect(await screen.findByText('holiday')).toBeInTheDocument()
    first.unmount()

    render(
      <ApiProvider api={api}>
        <Probe jy={1405} />
      </ApiProvider>
    )
    expect(screen.getByText('holiday')).toBeInTheDocument()
    expect(calls).toBe(1)
  })

  it('drops a response that arrives after unmount', async () => {
    let answer!: (rows: { jm: number; jd: number; info: { isHoliday: boolean; events: [] } }[]) => void
    const api = createFakeApi({ holidays: { year: () => new Promise((r) => (answer = r)) } })
    const { unmount } = render(
      <ApiProvider api={api}>
        <Probe jy={1406} />
      </ApiProvider>
    )
    unmount()
    await act(async () => answer([{ jm: 1, jd: 1, info: { isHoliday: false, events: [] } }]))

    // Nothing was cached from the late answer: a new mount asks again.
    let asked = false
    const api2 = createFakeApi({
      holidays: {
        year: async () => {
          asked = true
          return []
        }
      }
    })
    render(
      <ApiProvider api={api2}>
        <Probe jy={1406} />
      </ApiProvider>
    )
    await waitFor(() => expect(asked).toBe(true))
  })
})

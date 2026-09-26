// The shared "sync now" / "refresh holidays now" actions guard against double starts,
// including while a different action (connect/disconnect) holds the busy flag.
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ApiProvider } from '@renderer/apiContext'
import { useBackgroundActions } from '@renderer/useBackgroundActions'
import { useSyncStore } from '@renderer/syncStore'
import { createFakeApi, type FakeApi } from '../support/FakeApi'
import { resetRendererStores } from '../support/renderApp'
import type { HolidayStatus, SyncStatus } from '@shared/events'

function hook(api: FakeApi) {
  return renderHook(() => useBackgroundActions(), {
    wrapper: ({ children }) => <ApiProvider api={api}>{children}</ApiProvider>
  })
}

beforeEach(() => {
  resetRendererStores()
  useSyncStore.setState({ status: { phase: 'idle', connected: true, configured: true } })
})

describe('useBackgroundActions', () => {
  it('syncNow holds the busy flag for its duration and stores the result', async () => {
    let finish!: (s: SyncStatus) => void
    const api = createFakeApi({ google: { syncNow: () => new Promise<SyncStatus>((r) => (finish = r)) } })
    const { result } = hook(api)
    let done!: Promise<void>
    act(() => {
      done = result.current.syncNow()
    })
    expect(result.current.syncing).toBe(true)
    await act(async () => {
      finish({ phase: 'idle', connected: true, configured: true, lastSuccessAt: 9 })
      await done
    })
    expect(useSyncStore.getState().busy).toBeNull()
    expect(useSyncStore.getState().status.lastSuccessAt).toBe(9)
  })

  it('syncNow does nothing while another action (e.g. disconnect) is in flight, or a sync is running', async () => {
    let calls = 0
    const api = createFakeApi({
      google: {
        syncNow: async () => {
          calls++
          return useSyncStore.getState().status
        }
      }
    })
    useSyncStore.setState({ busy: 'disconnect' })
    const { result, rerender } = hook(api)
    await act(() => result.current.syncNow())

    useSyncStore.setState({ busy: null, status: { phase: 'syncing', connected: true, configured: true } })
    rerender()
    await act(() => result.current.syncNow())
    expect(calls).toBe(0)
    expect(useSyncStore.getState().busy).toBeNull()
  })

  it('refreshHolidays shows refreshing at once, and ignores a second call meanwhile', async () => {
    let calls = 0
    let finish!: (s: HolidayStatus) => void
    const api = createFakeApi({
      holidays: {
        refreshNow: () => {
          calls++
          return new Promise<HolidayStatus>((r) => (finish = r))
        }
      }
    })
    const { result } = hook(api)
    let first!: Promise<void>
    act(() => {
      first = result.current.refreshHolidays()
    })
    expect(result.current.refreshingHolidays).toBe(true)
    await act(() => result.current.refreshHolidays())
    expect(calls).toBe(1)

    await act(async () => {
      finish({ phase: 'idle', lastSuccessAt: 3 })
      await first
    })
    expect(result.current.refreshingHolidays).toBe(false)
  })
})

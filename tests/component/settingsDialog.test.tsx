import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiProvider } from '@renderer/apiContext'
import { SettingsDialog } from '@renderer/components/SettingsDialog'
import { useSyncStore } from '@renderer/syncStore'
import { createFakeApi } from '../support/FakeApi'
import type { SyncStatus } from '@shared/events'

function renderDialog(api: ReturnType<typeof createFakeApi>, status: SyncStatus) {
  useSyncStore.setState({
    status,
    calendars: [],
    settingsOpen: true,
    busy: null
  })
  return render(
    <ApiProvider api={api}>
      <SettingsDialog onClose={() => useSyncStore.getState().closeSettings()} />
    </ApiProvider>
  )
}

beforeEach(() => {
  useSyncStore.setState({ status: { phase: 'disabled', connected: false, configured: false }, calendars: [], settingsOpen: false, busy: null })
})

describe('SettingsDialog — not configured', () => {
  it('shows the not-configured notice and no connect button', () => {
    const api = createFakeApi()
    renderDialog(api, { phase: 'disabled', connected: false, configured: false })
    expect(screen.getByText('همگام‌سازی در این نسخه پیکربندی نشده است.')).toBeInTheDocument()
    expect(screen.queryByText('اتصال حساب گوگل')).not.toBeInTheDocument()
  })
})

describe('SettingsDialog — disconnected', () => {
  it('shows the explainer and a connect button that calls api.google.connect', async () => {
    const user = userEvent.setup()
    let connected = false
    const api = createFakeApi({
      google: {
        connect: async () => {
          connected = true
          return { phase: 'idle', connected: true, configured: true, email: 'me@x.com' }
        }
      } as any
    })
    renderDialog(api, { phase: 'idle', connected: false, configured: true })

    expect(screen.getByText(/رویدادهای هنگام با تقویم گوگل شما/)).toBeInTheDocument()
    await user.click(screen.getByText('اتصال حساب گوگل'))
    expect(connected).toBe(true)
  })
})

describe('SettingsDialog — connecting', () => {
  it('shows the browser-opened message and a cancel button', async () => {
    const user = userEvent.setup()
    let cancelled = false
    const api = createFakeApi({ google: { cancelConnect: async () => { cancelled = true } } as any })
    renderDialog(api, { phase: 'connecting', connected: false, configured: true })

    expect(screen.getByText('صفحهٔ ورود در مرورگر باز شد. پس از تأیید، به هنگام بازگردید.')).toBeInTheDocument()
    await user.click(screen.getByText('انصراف از اتصال'))
    expect(cancelled).toBe(true)
  })
})

describe('SettingsDialog — connected', () => {
  it('shows the account email, calendar rows, and a relative last-synced line', async () => {
    const api = createFakeApi({
      google: {
        listCalendars: async () => [
          { calendarId: 'primary', summary: 'Me', color: '#3b82f6', enabled: true, isDefaultTarget: true },
          { calendarId: 'shared1', summary: 'Team', color: '#ef4444', enabled: false, isDefaultTarget: false }
        ]
      } as any
    })
    const now = Date.now()
    renderDialog(api, { phase: 'idle', connected: true, configured: true, email: 'me@example.com', lastSuccessAt: now - 5 * 60_000 })

    expect(await screen.findByText('me@example.com')).toBeInTheDocument()
    expect(await screen.findByText('Me')).toBeInTheDocument()
    expect(await screen.findByText('Team')).toBeInTheDocument()
    expect(await screen.findByText(/دقیقه پیش/)).toBeInTheDocument()
  })

  it('shows "not synced yet" when there is no lastSuccessAt', async () => {
    const api = createFakeApi({ google: { listCalendars: async () => [] } as any })
    renderDialog(api, { phase: 'idle', connected: true, configured: true, email: 'me@example.com' })
    expect(await screen.findByText('هنوز همگام‌سازی نشده است')).toBeInTheDocument()
  })

  it('toggling a calendar checkbox calls setCalendarEnabled', async () => {
    const user = userEvent.setup()
    const calls: [string, boolean][] = []
    const api = createFakeApi({
      google: {
        listCalendars: async () => [{ calendarId: 'primary', summary: 'Me', enabled: true, isDefaultTarget: true }],
        setCalendarEnabled: async (id: string, enabled: boolean) => {
          calls.push([id, enabled])
        }
      } as any
    })
    renderDialog(api, { phase: 'idle', connected: true, configured: true })
    const checkbox = await screen.findByRole('checkbox')
    await user.click(checkbox)
    expect(calls).toEqual([['primary', false]])
  })

  it('the default-target radio is disabled for a disabled calendar', async () => {
    const api = createFakeApi({
      google: {
        listCalendars: async () => [{ calendarId: 'off', summary: 'Off calendar', enabled: false, isDefaultTarget: false }]
      } as any
    })
    renderDialog(api, { phase: 'idle', connected: true, configured: true })
    const radio = await screen.findByRole('radio')
    expect(radio).toBeDisabled()
  })

  it('shows the mapped Persian message for an error phase', async () => {
    const api = createFakeApi({ google: { listCalendars: async () => [] } as any })
    renderDialog(api, { phase: 'error', connected: true, configured: true, errorCode: 'network' })
    expect(await screen.findByText('اتصال به اینترنت برقرار نیست.')).toBeInTheDocument()
  })

  it('shows "در حال همگام‌سازی…" while syncing', async () => {
    const api = createFakeApi({ google: { listCalendars: async () => [] } as any })
    renderDialog(api, { phase: 'syncing', connected: true, configured: true })
    expect(await screen.findByText('در حال همگام‌سازی…')).toBeInTheDocument()
  })

  it('the disconnect confirmation gates the actual disconnect call', async () => {
    const user = userEvent.setup()
    let disconnected = false
    const api = createFakeApi({
      google: {
        listCalendars: async () => [],
        disconnect: async () => {
          disconnected = true
          return { phase: 'idle', connected: false, configured: true }
        }
      } as any
    })
    renderDialog(api, { phase: 'idle', connected: true, configured: true })

    await user.click(screen.getByText('قطع اتصال'))
    expect(disconnected).toBe(false) // not yet — confirmation shown first
    expect(screen.getByText(/رویدادهای شما در هنگام باقی می‌مانند/)).toBeInTheDocument()

    const confirmButtons = screen.getAllByText('قطع اتصال')
    await user.click(confirmButtons[confirmButtons.length - 1])
    await waitFor(() => expect(disconnected).toBe(true))
  })

  it('cancelling the disconnect confirmation does not call disconnect', async () => {
    const user = userEvent.setup()
    let disconnected = false
    const api = createFakeApi({
      google: { listCalendars: async () => [], disconnect: async () => { disconnected = true; return { phase: 'idle', connected: false, configured: true } } } as any
    })
    renderDialog(api, { phase: 'idle', connected: true, configured: true })

    await user.click(screen.getByText('قطع اتصال'))
    await user.click(screen.getByText('انصراف'))
    expect(disconnected).toBe(false)
    expect(screen.getByText('قطع اتصال')).toBeInTheDocument() // back to the plain button
  })

  it('clicking سینک "همگام‌سازی" calls syncNow', async () => {
    const user = userEvent.setup()
    let synced = false
    const api = createFakeApi({
      google: { listCalendars: async () => [], syncNow: async () => { synced = true; return { phase: 'idle', connected: true, configured: true } } } as any
    })
    renderDialog(api, { phase: 'idle', connected: true, configured: true })
    await user.click(screen.getByText('همگام‌سازی'))
    await waitFor(() => expect(synced).toBe(true))
  })

  it('closing the dialog calls onClose', async () => {
    const user = userEvent.setup()
    const api = createFakeApi({ google: { listCalendars: async () => [] } as any })
    renderDialog(api, { phase: 'idle', connected: true, configured: true })
    await user.click(screen.getByText('بستن'))
    expect(useSyncStore.getState().settingsOpen).toBe(false)
  })
})

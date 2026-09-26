// Behaviour of the redesigned settings dialog: the two background-job tabs, the holiday
// refresh status, and the failure-alert threshold fields.
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiProvider } from '@renderer/apiContext'
import { SettingsDialog } from '@renderer/components/SettingsDialog'
import { useSyncStore } from '@renderer/syncStore'
import { createFakeApi, type FakeApi } from '../support/FakeApi'
import { resetRendererStores } from '../support/renderApp'
import type { HolidayStatus, SettingsSection, SyncStatus } from '@shared/events'
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '@shared/notifications'

const MIN = 60_000
const HOUR = 60 * MIN
const connected: SyncStatus = { phase: 'idle', connected: true, configured: true, email: 'me@example.com', lastSuccessAt: Date.now() - 5 * MIN }

function renderSettings(
  opts: { api?: FakeApi; section?: SettingsSection; status?: SyncStatus; holidayStatus?: HolidayStatus } = {}
) {
  const api = opts.api ?? createFakeApi()
  useSyncStore.setState({
    settingsOpen: true,
    settingsSection: opts.section ?? 'google',
    status: opts.status ?? connected,
    holidayStatus: opts.holidayStatus ?? { phase: 'idle' }
  })
  render(
    <ApiProvider api={api}>
      <SettingsHost />
    </ApiProvider>
  )
  return { api, user: userEvent.setup() }
}

/** Mounts the dialog only while it's open, exactly as App does, so closing unmounts it. */
function SettingsHost() {
  const open = useSyncStore((s) => s.settingsOpen)
  const close = useSyncStore((s) => s.closeSettings)
  return open ? <SettingsDialog onClose={close} /> : null
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })

beforeEach(() => {
  resetRendererStores()
})

describe('Settings — tabs', () => {
  it('opens on the requested tab, with the panel labelled by it', () => {
    renderSettings({ section: 'holidays' })
    expect(tab(/تعطیلات رسمی/)).toHaveAttribute('aria-selected', 'true')
    expect(tab(/تقویم گوگل/)).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel', { name: /تعطیلات رسمی/ })).toBeInTheDocument()
  })

  it('switches tabs by click, and only the selected tab is in the tab order', async () => {
    const { user } = renderSettings()
    expect(tab(/تقویم گوگل/)).toHaveAttribute('tabIndex', '0')
    expect(tab(/تعطیلات رسمی/)).toHaveAttribute('tabIndex', '-1')
    await user.click(tab(/تعطیلات رسمی/))
    expect(screen.getByText('به‌روزرسانی بعدی')).toBeInTheDocument()
    expect(useSyncStore.getState().settingsSection).toBe('holidays')
  })

  it('moves between tabs with the arrow keys (RTL: left is next), Home and End', async () => {
    const { user } = renderSettings()
    tab(/تقویم گوگل/).focus()
    await user.keyboard('{ArrowLeft}')
    expect(tab(/تعطیلات رسمی/)).toHaveFocus()
    expect(tab(/تعطیلات رسمی/)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}') // wraps around
    expect(tab(/تقویم گوگل/)).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(tab(/تعطیلات رسمی/)).toHaveFocus()
    await user.keyboard('{Home}')
    expect(tab(/تقویم گوگل/)).toHaveFocus()
    await user.keyboard('{End}')
    expect(tab(/تعطیلات رسمی/)).toHaveFocus()
    await user.keyboard('a') // other keys do nothing
    expect(tab(/تعطیلات رسمی/)).toHaveFocus()
  })

  it('flags a tab whose job is currently failing', () => {
    renderSettings({
      status: { ...connected, phase: 'error', failingSince: Date.now() - HOUR },
      holidayStatus: { phase: 'idle' }
    })
    expect(tab(/تقویم گوگل/)).toHaveAccessibleName('تقویم گوگل ناموفق')
    expect(tab(/تعطیلات رسمی/)).toHaveAccessibleName('تعطیلات رسمی')
  })

  it('reopens on the tab that was last shown', async () => {
    const { user } = renderSettings()
    await user.click(tab(/تعطیلات رسمی/))
    act(() => {
      useSyncStore.getState().closeSettings()
      useSyncStore.getState().openSettings()
    })
    expect(useSyncStore.getState().settingsSection).toBe('holidays')
  })
})

describe('Settings — official holidays tab', () => {
  it('before any refresh: says so, with no next time until the schedule starts', () => {
    renderSettings({ section: 'holidays' })
    expect(screen.getByText('هنوز انجام نشده')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText(/هر روز به‌طور خودکار از time\.ir/)).toBeInTheDocument()
  })

  it('when healthy: shows when it last updated and when it will next', () => {
    const now = Date.now()
    renderSettings({
      section: 'holidays',
      holidayStatus: { phase: 'idle', lastSuccessAt: now - 2 * HOUR, nextAttemptAt: now + 22 * HOUR }
    })
    expect(screen.getByText('۲ ساعت پیش')).toBeInTheDocument()
    expect(screen.getByText('۲۲ ساعت دیگر')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('when failing: explains for how long and why, and when it will retry', () => {
    const now = Date.now()
    renderSettings({
      section: 'holidays',
      holidayStatus: {
        phase: 'error',
        lastSuccessAt: now - 4 * 24 * HOUR,
        failingSince: now - 3 * 24 * HOUR,
        nextAttemptAt: now + 16 * MIN,
        errorCode: 'site_changed'
      }
    })
    const callout = screen.getByRole('status')
    expect(within(callout).getByText('دریافت از ۳ روز پیش ناموفق است.')).toBeInTheDocument()
    expect(callout).toHaveTextContent('ساختار سایت time.ir تغییر کرده است')
    expect(screen.getByText('۱۶ دقیقه دیگر')).toBeInTheDocument()
  })

  it('"update now" refreshes, showing progress until main answers', async () => {
    let finish!: (s: HolidayStatus) => void
    const api = createFakeApi({ holidays: { refreshNow: () => new Promise<HolidayStatus>((r) => (finish = r)) } })
    const now = Date.now()
    const { user } = renderSettings({
      api,
      section: 'holidays',
      holidayStatus: { phase: 'error', failingSince: now - HOUR, errorCode: 'network', nextAttemptAt: now + MIN }
    })

    await user.click(screen.getByRole('button', { name: 'به‌روزرسانی' }))
    expect(screen.getByRole('button', { name: 'در حال به‌روزرسانی…' })).toBeDisabled()
    expect(screen.getByText('در حال انجام…')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument() // no stale error while retrying

    await act(async () => finish({ phase: 'idle', lastSuccessAt: now, nextAttemptAt: now + 24 * HOUR }))
    expect(screen.getByRole('button', { name: 'به‌روزرسانی' })).toBeEnabled()
    expect(screen.getByText('لحظاتی پیش')).toBeInTheDocument()
  })

  it('a second click while refreshing does nothing', async () => {
    let calls = 0
    const api = createFakeApi({
      holidays: {
        refreshNow: () => {
          calls++
          return new Promise<HolidayStatus>(() => {})
        }
      }
    })
    const { user } = renderSettings({ api, section: 'holidays' })
    const button = screen.getByRole('button', { name: 'به‌روزرسانی' })
    await user.click(button)
    button.removeAttribute('disabled') // even if the button were somehow still clickable
    await user.click(button)
    expect(calls).toBe(1)
  })
})

describe('Settings — failure alert thresholds', () => {
  it('shows each job its stored threshold in the most natural unit', async () => {
    const api = createFakeApi({}, { alerts: { syncFailureMin: 720, holidayFailureMin: 2 * 1440 } })
    const { user } = renderSettings({ api })
    const syncField = await screen.findByRole('group', { name: 'هشدار خرابی' })
    expect(within(syncField).getByRole('spinbutton', { name: 'مدت' })).toHaveValue(12)
    expect(within(syncField).getByRole('combobox', { name: 'واحد مدت' })).toHaveValue('h')
    expect(syncField).toHaveTextContent('اگر همگام‌سازی')

    await user.click(tab(/تعطیلات رسمی/))
    const holidayField = await screen.findByRole('group', { name: 'هشدار خرابی' })
    expect(within(holidayField).getByRole('spinbutton', { name: 'مدت' })).toHaveValue(2)
    expect(within(holidayField).getByRole('combobox', { name: 'واحد مدت' })).toHaveValue('d')
    expect(holidayField).toHaveTextContent('اگر دریافت تعطیلات')
  })

  it('saves a valid value when the field is left, keeping the unit the user chose', async () => {
    const api = createFakeApi()
    const { user } = renderSettings({ api })
    const input = await screen.findByRole('spinbutton', { name: 'مدت' })
    await user.clear(input)
    await user.type(input, '24')
    expect(api.getAlerts().syncFailureMin).toBe(720) // not per keystroke

    await user.tab()
    await waitFor(() => expect(api.getAlerts().syncFailureMin).toBe(24 * 60))
    expect(input).toHaveValue(24) // not flipped to "1 day" after the save round trip
    expect(screen.getByRole('combobox', { name: 'واحد مدت' })).toHaveValue('h')
  })

  it('leaving the field unchanged saves nothing', async () => {
    let saves = 0
    const api = createFakeApi({
      settings: {
        setAlerts: async (patch: Partial<AlertSettings>) => {
          saves++
          return { ...DEFAULT_ALERT_SETTINGS, ...patch }
        }
      }
    })
    const { user } = renderSettings({ api })
    await user.click(await screen.findByRole('spinbutton', { name: 'مدت' }))
    await user.tab()
    expect(saves).toBe(0)
  })

  it('closing the dialog with a valid edit pending still saves it', async () => {
    const api = createFakeApi()
    const { user } = renderSettings({ api })
    const input = await screen.findByRole('spinbutton', { name: 'مدت' })
    await user.clear(input)
    await user.type(input, '3')
    await user.keyboard('{Escape}')
    expect(useSyncStore.getState().settingsOpen).toBe(false)
    await waitFor(() => expect(api.getAlerts().syncFailureMin).toBe(3 * 60))
  })

  it('switching tabs with an edit pending saves it too', async () => {
    const api = createFakeApi()
    const { user } = renderSettings({ api })
    const input = await screen.findByRole('spinbutton', { name: 'مدت' })
    await user.clear(input)
    await user.type(input, '5')
    await user.click(tab(/تعطیلات رسمی/))
    await waitFor(() => expect(api.getAlerts().syncFailureMin).toBe(5 * 60))
  })

  it('switching the unit re-saves the same number in the new unit', async () => {
    const api = createFakeApi()
    const { user } = renderSettings({ api, section: 'holidays' })
    const input = await screen.findByRole('spinbutton', { name: 'مدت' })
    await user.clear(input)
    await user.type(input, '6')
    await user.selectOptions(screen.getByRole('combobox', { name: 'واحد مدت' }), 'h')
    await waitFor(() => expect(api.getAlerts().holidayFailureMin).toBe(6 * 60))
  })

  it.each([
    ['empty', '', '۷۲۰'],
    ['zero', '0', '۷۲۰'],
    ['too long', '721', '۷۲۰'],
    ['fractional', '1.5', '۷۲۰']
  ])('rejects a %s value with an explanation, and saves nothing — not even a valid prefix', async (_name, typed, max) => {
    const api = createFakeApi()
    const { user } = renderSettings({ api })
    const input = await screen.findByRole('spinbutton', { name: 'مدت' })
    await user.clear(input)
    if (typed) await user.type(input, typed)
    await user.tab()

    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent(`عددی صحیح بین ۱ و ${max} وارد کنید.`)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(error.textContent!)
    expect(api.getAlerts().syncFailureMin).toBe(720)
  })

  it('checks the range against the chosen unit: 45 hours is fine, 45 days is not', async () => {
    const api = createFakeApi()
    const { user } = renderSettings({ api })
    const input = await screen.findByRole('spinbutton', { name: 'مدت' })
    await user.clear(input)
    await user.type(input, '45')
    await user.tab()
    await waitFor(() => expect(api.getAlerts().syncFailureMin).toBe(45 * 60))
    await user.selectOptions(screen.getByRole('combobox', { name: 'واحد مدت' }), 'd')
    expect(screen.getByRole('alert')).toHaveTextContent('عددی صحیح بین ۱ و ۳۰ وارد کنید.')
    expect(api.getAlerts().syncFailureMin).toBe(45 * 60)
  })

  it('is not shown until Google is connected — there is nothing to alert about before that', async () => {
    renderSettings({ status: { phase: 'idle', connected: false, configured: true } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'اتصال حساب گوگل' })).toBeInTheDocument())
    expect(screen.queryByRole('group', { name: 'هشدار خرابی' })).not.toBeInTheDocument()
  })
})

describe('Settings — Google tab additions', () => {
  it('shows how long sync has been failing under the status line', () => {
    renderSettings({ status: { ...connected, phase: 'error', errorCode: 'server', failingSince: Date.now() - 3 * HOUR } })
    expect(screen.getByRole('status')).toHaveTextContent('سرویس گوگل در دسترس نیست.')
    expect(screen.getByText('همگام‌سازی از ۳ ساعت پیش ناموفق است.')).toBeInTheDocument()
  })

  it('explains why a connect attempt failed', () => {
    renderSettings({ status: { phase: 'idle', connected: false, configured: true, errorCode: 'denied' } })
    expect(screen.getByText('دسترسی به تقویم گوگل داده نشد.')).toBeInTheDocument()
  })

  it('refreshes the calendar list on request', async () => {
    let refreshed = 0
    const api = createFakeApi({
      google: {
        refreshCalendars: async () => {
          refreshed++
          return [{ calendarId: 'c', summary: 'تازه', enabled: true, isDefaultTarget: true }]
        }
      }
    })
    const { user } = renderSettings({ api })
    await user.click(screen.getByRole('button', { name: 'به‌روزرسانی فهرست تقویم‌ها' }))
    expect(await screen.findByText('تازه')).toBeInTheDocument()
    expect(refreshed).toBe(1)
  })
})

describe('Settings — choosing where new events go', () => {
  it('picking another enabled calendar as the default saves it and moves the selection', async () => {
    const targets: string[] = []
    const api = createFakeApi({
      google: {
        listCalendars: async () => [
          { calendarId: 'me', summary: 'Me', enabled: true, isDefaultTarget: true },
          { calendarId: 'team', summary: 'Team', enabled: true, isDefaultTarget: false }
        ],
        setDefaultTarget: async (id: string) => void targets.push(id)
      }
    })
    const { user } = renderSettings({ api })
    const radios = await screen.findAllByRole('radio', { name: 'تقویم پیش‌فرض برای رویدادهای جدید' })
    await user.click(radios[1])
    expect(targets).toEqual(['team'])
    expect(radios[1]).toBeChecked()
    expect(radios[0]).not.toBeChecked()

    // Disabling one calendar leaves the other as it was.
    await user.click(screen.getByRole('checkbox', { name: 'Me' }))
    expect(screen.getByRole('checkbox', { name: 'Me' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Team' })).toBeChecked()
    expect(radios[0]).toBeDisabled()
  })
})

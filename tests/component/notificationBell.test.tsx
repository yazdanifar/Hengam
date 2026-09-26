// Behaviour of the header bell, driven through the real App and main bridge against the
// FakeApi's inbox: opening marks read → the inbox announces a change → the bridge reloads.
import { beforeEach, describe, expect, it } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createFakeApi, type FakeApi } from '../support/FakeApi'
import { renderApp, resetRendererStores } from '../support/renderApp'
import { useAppStore } from '@renderer/store'
import { useSyncStore } from '@renderer/syncStore'
import { useNotificationStore } from '@renderer/notificationStore'
import type { AppNotification } from '@shared/notifications'
import type { SyncStatus } from '@shared/events'

const MIN = 60_000
const HOUR = 60 * MIN
const now = Date.now()
const EVENT_START = new Date(2026, 9, 5, 9, 10).getTime() // 13 Mehr 1405

const reminder = (id: number, patch: Partial<AppNotification> = {}): AppNotification => ({
  id,
  kind: 'reminder',
  createdAt: now - 5 * MIN,
  title: `جلسه ${id}`,
  body: '۰۹:۱۰ — ۱۰ دقیقه دیگر',
  eventStartTs: EVENT_START,
  ...patch
})
const syncAlert: AppNotification = { id: 100, kind: 'sync_failure', createdAt: now - HOUR, failingSince: now - 14 * HOUR, title: '' }
const holidayAlert: AppNotification = { id: 101, kind: 'holiday_failure', createdAt: now - HOUR, failingSince: now - 3 * 24 * HOUR, title: '' }

const connected: SyncStatus = { phase: 'error', connected: true, configured: true, errorCode: 'network', failingSince: now - 14 * HOUR }

async function openApp(notifications: AppNotification[], api: FakeApi = createFakeApi({}, { notifications })) {
  const user = userEvent.setup()
  renderApp(api)
  const bell = await screen.findByRole('button', { name: /^اعلان‌ها/ })
  // Wait for the bridge's first inbox load to land in the store.
  await waitFor(() => expect(useNotificationStore.getState().items).toEqual(api.getNotifications()))
  return { user, api, bell }
}

const panel = () => screen.getByRole('dialog', { name: 'اعلان‌ها' })

beforeEach(() => {
  resetRendererStores()
})

describe('Header', () => {
  it('has no sync status pill any more — a bell and a settings button instead', async () => {
    await openApp([])
    expect(screen.queryByRole('status', { name: /همگام‌سازی/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'اعلان‌ها' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'تنظیمات' })).toBeInTheDocument()
  })

  it('the settings button opens the settings dialog', async () => {
    const { user } = await openApp([])
    await user.click(screen.getByRole('button', { name: 'تنظیمات' }))
    expect(screen.getByRole('dialog', { name: 'تنظیمات' })).toBeInTheDocument()
  })
})

describe('Header navigation', () => {
  it('steps days back and forward, returns to today, and switches views', async () => {
    const { user } = await openApp([])
    const today = useAppStore.getState().selectedGregorian.getTime()
    await user.click(screen.getByRole('button', { name: 'بعدی' }))
    expect(useAppStore.getState().selectedGregorian.getTime()).toBeGreaterThan(today)
    await user.click(screen.getByRole('button', { name: 'قبلی' }))
    await user.click(screen.getByRole('button', { name: 'قبلی' }))
    expect(useAppStore.getState().selectedGregorian.getTime()).toBeLessThan(today)
    await user.click(screen.getByRole('button', { name: 'امروز' }))
    expect(useAppStore.getState().selectedGregorian.getTime()).toBe(today)

    await user.click(screen.getByRole('tab', { name: 'هفته' }))
    expect(screen.getByRole('tab', { name: 'هفته' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'ماه' }))
    expect(useAppStore.getState().view).toBe('month')
  })
})

describe('Notification bell — empty', () => {
  it('shows no badge, and an explanatory empty state when opened', async () => {
    const { user, bell, api } = await openApp([])
    const markAllRead = api.notifications.markAllRead
    expect(bell).toHaveAccessibleName('اعلان‌ها')
    expect(bell.querySelector('.bell-badge')).toBeNull()

    await user.click(bell)
    expect(within(panel()).getByText('اعلان تازه‌ای ندارید')).toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: 'پاک کردن همه' })).not.toBeInTheDocument()
    expect(markAllRead).toBe(api.notifications.markAllRead)
  })
})

describe('Notification bell — unread reminders', () => {
  it('counts unread items in the badge and the accessible name', async () => {
    const { bell } = await openApp([reminder(1), reminder(2), reminder(3, { readAt: now })])
    await waitFor(() => expect(bell).toHaveAccessibleName('اعلان‌ها، ۲ خوانده‌نشده'))
    expect(bell.querySelector('.bell-badge')).toHaveTextContent('۲')
  })

  it('caps the badge at ۹+', async () => {
    const { bell } = await openApp(Array.from({ length: 12 }, (_, i) => reminder(i + 1)))
    await waitFor(() => expect(bell.querySelector('.bell-badge')).toHaveTextContent('۹+'))
  })

  it('opening marks everything read — the badge clears, but this visit still highlights what was new', async () => {
    const { user, bell, api } = await openApp([reminder(1), reminder(2, { readAt: now })])
    await waitFor(() => expect(bell.querySelector('.bell-badge')).not.toBeNull())

    await user.click(bell)
    expect(bell).toHaveAttribute('aria-expanded', 'true')
    expect(panel()).toHaveFocus()
    await waitFor(() => expect(bell.querySelector('.bell-badge')).toBeNull())
    expect(api.getNotifications().every((n) => n.readAt !== undefined)).toBe(true)

    const items = within(panel()).getAllByRole('listitem')
    expect(items[0]).toHaveClass('is-new')
    expect(within(items[0]).getByText(/جدید/)).toBeInTheDocument()
    expect(items[1]).not.toHaveClass('is-new')

    // Closing and reopening: nothing is new any more.
    await user.click(bell)
    expect(bell).toHaveFocus()
    await user.click(bell)
    expect(within(panel()).getAllByRole('listitem')[0]).not.toHaveClass('is-new')
  })

  it('shows each reminder with its body and when it fired', async () => {
    const { user, bell } = await openApp([reminder(1)])
    await user.click(bell)
    const item = within(panel()).getByRole('listitem')
    expect(within(item).getByText('جلسه 1')).toBeInTheDocument()
    expect(within(item).getByText('۰۹:۱۰ — ۱۰ دقیقه دیگر')).toBeInTheDocument()
    expect(within(item).getByText('۵ دقیقه پیش')).toBeInTheDocument()
  })

  it('clicking a reminder jumps to its day, closes the panel and returns focus to the bell', async () => {
    const { user, bell } = await openApp([reminder(1)])
    await user.click(bell)
    await user.click(within(panel()).getByRole('button', { name: /^(جدید: )?جلسه 1/ }))

    expect(screen.queryByRole('dialog', { name: 'اعلان‌ها' })).not.toBeInTheDocument()
    expect(bell).toHaveFocus()
    expect(useAppStore.getState().selectedDate).toEqual({ jy: 1405, jm: 7, jd: 13 })
  })

  it('a reminder with no event time is shown but not clickable', async () => {
    const { user, bell } = await openApp([reminder(1, { eventStartTs: undefined })])
    await user.click(bell)
    expect(within(panel()).queryByRole('button', { name: /^(جدید: )?جلسه 1/ })).not.toBeInTheDocument()
    expect(within(panel()).getByText('جلسه 1')).toBeInTheDocument()
  })

  it('dismissing removes one entry; "clear all" removes the rest', async () => {
    const { user, bell } = await openApp([reminder(1), reminder(2)])
    await user.click(bell)
    await user.click(within(panel()).getByRole('button', { name: 'حذف اعلان «جلسه 1»' }))
    await waitFor(() => expect(within(panel()).getAllByRole('listitem')).toHaveLength(1))

    await user.click(within(panel()).getByRole('button', { name: 'پاک کردن همه' }))
    expect(await within(panel()).findByText('اعلان تازه‌ای ندارید')).toBeInTheDocument()
  })
})

describe('Notification bell — dismissing the panel', () => {
  it('Escape closes it and returns focus to the bell', async () => {
    const { user, bell } = await openApp([reminder(1)])
    await user.click(bell)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'اعلان‌ها' })).not.toBeInTheDocument()
    expect(bell).toHaveFocus()
  })

  it('clicking elsewhere closes it without pulling focus back, while clicks inside keep it open', async () => {
    const { user, bell } = await openApp([reminder(1)])
    await user.click(bell)
    await user.click(within(panel()).getByRole('heading', { name: 'اعلان‌ها' }))
    expect(panel()).toBeInTheDocument()

    const today = screen.getByRole('button', { name: 'امروز' })
    await user.click(today)
    expect(screen.queryByRole('dialog', { name: 'اعلان‌ها' })).not.toBeInTheDocument()
    expect(bell).toHaveAttribute('aria-expanded', 'false')
    expect(today).toHaveFocus()
  })
})

describe('Notification bell — failure alerts', () => {
  it('turns the bell red while an alert is active, even once read', async () => {
    const { bell } = await openApp([{ ...syncAlert, readAt: now }])
    await waitFor(() => expect(bell).toHaveClass('has-alert'))
    expect(bell).toHaveAccessibleName('اعلان‌ها، نیازمند توجه')
    expect(bell.querySelector('.bell-dot')).not.toBeNull()
    expect(bell.querySelector('.bell-badge')).toBeNull()
  })

  it('pins active alerts under "needs attention" with the reason, and they cannot be dismissed or cleared', async () => {
    const api = createFakeApi({}, { notifications: [syncAlert, reminder(1)] })
    api.emitSyncStatus(connected)
    const { user, bell } = await openApp([syncAlert, reminder(1)], api)
    await user.click(bell)

    const attention = within(panel()).getByRole('region', { name: 'نیازمند توجه' })
    const card = within(attention).getByRole('group', { name: 'همگام‌سازی با تقویم گوگل ناموفق است' })
    expect(within(card).getByText('از ۱۴ ساعت پیش هیچ همگام‌سازی موفقی انجام نشده است.')).toBeInTheDocument()
    expect(within(card).getByText('اتصال به اینترنت برقرار نیست.')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /حذف/ })).not.toBeInTheDocument()

    await user.click(within(panel()).getByRole('button', { name: 'پاک کردن همه' }))
    await waitFor(() => expect(within(panel()).queryByRole('listitem')).not.toBeInTheDocument())
    expect(within(panel()).getByRole('group', { name: /گوگل/ })).toBeInTheDocument()
  })

  it('"retry" on a sync alert runs a sync and shows progress meanwhile', async () => {
    let finish!: (s: SyncStatus) => void
    const api = createFakeApi(
      { google: { syncNow: () => new Promise<SyncStatus>((r) => (finish = r)) } },
      { notifications: [syncAlert] }
    )
    api.emitSyncStatus(connected)
    const { user, bell } = await openApp([syncAlert], api)
    await user.click(bell)

    await user.click(within(panel()).getByRole('button', { name: 'تلاش دوباره' }))
    expect(within(panel()).getByRole('button', { name: 'در حال تلاش…' })).toBeDisabled()
    await act(async () => finish({ ...connected, phase: 'idle', errorCode: undefined, failingSince: undefined }))
    expect(useSyncStore.getState().status.phase).toBe('idle')
  })

  it('"retry" on a holiday alert refreshes holidays', async () => {
    let calls = 0
    const api = createFakeApi(
      {
        holidays: {
          refreshNow: async () => {
            calls++
            return { phase: 'idle' as const, lastSuccessAt: now }
          }
        }
      },
      { notifications: [holidayAlert], holidayStatus: { phase: 'error', failingSince: now - 3 * 24 * HOUR, errorCode: 'blocked' } }
    )
    const { user, bell } = await openApp([holidayAlert], api)
    await user.click(bell)
    const card = within(panel()).getByRole('group', { name: 'به‌روزرسانی تعطیلات رسمی ناموفق است' })
    expect(within(card).getByText('time.ir درخواست را نپذیرفت.')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'تلاش دوباره' }))
    expect(calls).toBe(1)
    await waitFor(() => expect(useSyncStore.getState().holidayStatus.lastSuccessAt).toBe(now))
  })

  it('"settings" closes the panel and opens settings on the tab for that job', async () => {
    const { user, bell } = await openApp([holidayAlert])
    await user.click(bell)
    await user.click(within(panel()).getByRole('button', { name: 'تنظیمات' }))

    expect(screen.queryByRole('dialog', { name: 'اعلان‌ها' })).not.toBeInTheDocument()
    const settings = screen.getByRole('dialog', { name: 'تنظیمات' })
    expect(within(settings).getByRole('tab', { name: /تعطیلات رسمی/ })).toHaveAttribute('aria-selected', 'true')

    // Closing settings hands focus back to the bell.
    await user.click(within(settings).getByRole('button', { name: 'بستن' }))
    expect(bell).toHaveFocus()
  })

  it('"settings" on a sync alert opens the Google tab', async () => {
    const { user, bell } = await openApp([syncAlert])
    await user.click(bell)
    await user.click(within(panel()).getByRole('button', { name: 'تنظیمات' }))
    const settings = screen.getByRole('dialog', { name: 'تنظیمات' })
    expect(within(settings).getByRole('tab', { name: /تقویم گوگل/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('an alert resolved by main moves to the recent list as "fixed", and the bell returns to normal', async () => {
    const { user, bell, api } = await openApp([{ ...syncAlert, readAt: now }])
    await waitFor(() => expect(bell).toHaveClass('has-alert'))

    act(() => api.setNotifications([{ ...syncAlert, readAt: now, resolvedAt: now - 2 * MIN }]))
    await waitFor(() => expect(bell).not.toHaveClass('has-alert'))

    await user.click(bell)
    expect(within(panel()).queryByRole('region', { name: 'نیازمند توجه' })).not.toBeInTheDocument()
    const item = within(panel()).getByRole('listitem')
    expect(within(item).getByText('همگام‌سازی با تقویم گوگل ناموفق است')).toBeInTheDocument()
    expect(within(item).getByText('مشکل ۲ دقیقه پیش برطرف شد.')).toBeInTheDocument()
  })
})

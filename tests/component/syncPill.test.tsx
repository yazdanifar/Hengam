import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Header } from '@renderer/components/Header'
import { useSyncStore } from '@renderer/syncStore'
import { useAppStore } from '@renderer/store'

beforeEach(() => {
  useSyncStore.setState({ status: { phase: 'disabled', connected: false, configured: false }, calendars: [], settingsOpen: false, busy: null })
  useAppStore.setState({ view: 'day' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SyncPill (inside Header)', () => {
  it('is absent when sync is not configured', () => {
    useSyncStore.setState({ status: { phase: 'idle', connected: false, configured: false } })
    render(<Header />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is absent when configured but not connected', () => {
    useSyncStore.setState({ status: { phase: 'idle', connected: false, configured: true } })
    render(<Header />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows an idle checkmark with the right accessible name when connected', () => {
    useSyncStore.setState({ status: { phase: 'idle', connected: true, configured: true } })
    render(<Header />)
    const pill = screen.getByRole('status')
    expect(pill).toHaveAccessibleName('همگام‌سازی به‌روز است')
  })

  it('shows the error state with a distinct accessible name and is clickable to open settings', async () => {
    const user = userEvent.setup()
    useSyncStore.setState({ status: { phase: 'error', connected: true, configured: true, errorCode: 'network' } })
    render(<Header />)
    const pill = screen.getByRole('status')
    expect(pill).toHaveAccessibleName('همگام‌سازی ناموفق بود')

    await user.click(pill)
    expect(useSyncStore.getState().settingsOpen).toBe(true)
  })

  it('suppresses the syncing indicator for the first 400ms', () => {
    vi.useFakeTimers()
    useSyncStore.setState({ status: { phase: 'syncing', connected: true, configured: true } })
    render(<Header />)
    expect(screen.getByRole('status')).toHaveAccessibleName('همگام‌سازی به‌روز است')

    act(() => {
      vi.advanceTimersByTime(401)
    })
    expect(screen.getByRole('status')).toHaveAccessibleName('در حال همگام‌سازی')
  })

  it('the settings gear button opens settings', async () => {
    const user = userEvent.setup()
    render(<Header />)
    await user.click(screen.getByLabelText('تنظیمات'))
    expect(useSyncStore.getState().settingsOpen).toBe(true)
  })
})

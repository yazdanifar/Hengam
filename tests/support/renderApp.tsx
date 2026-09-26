import { render } from '@testing-library/react'
import { App } from '@renderer/App'
import { useSyncStore } from '@renderer/syncStore'
import { useNotificationStore } from '@renderer/notificationStore'
import { useAppStore } from '@renderer/store'
import { clearHolidayCache } from '@renderer/useHolidays'
import type { FakeApi } from './FakeApi'

/** Puts every renderer store back to its launch state, so tests don't leak into each other. */
export function resetRendererStores(): void {
  useSyncStore.setState({
    status: { phase: 'disabled', connected: false, configured: false },
    holidayStatus: { phase: 'idle' },
    calendars: [],
    settingsOpen: false,
    settingsSection: 'google',
    busy: null
  })
  useNotificationStore.setState({ items: [] })
  const today = new Date(new Date().setHours(0, 0, 0, 0))
  useAppStore.getState().goto(today)
  useAppStore.setState({ view: 'day', dataVersion: 0 })
  clearHolidayCache()
}

/** Renders the real App — header, bell, views, settings dialog and the main bridge — against
 *  a FakeApi standing in for the preload's window.api. */
export function renderApp(api: FakeApi) {
  window.api = api
  return render(<App />)
}

import { useApi } from './apiContext'
import { useSyncStore } from './syncStore'

/** "Sync now" and "refresh holidays now", shared by the settings tabs and the bell's alert
 *  cards so both guard against double-starts the same way. */
export function useBackgroundActions() {
  const api = useApi()
  const busy = useSyncStore((s) => s.busy)
  const syncPhase = useSyncStore((s) => s.status.phase)
  const holidayPhase = useSyncStore((s) => s.holidayStatus.phase)

  const syncing = busy === 'sync' || syncPhase === 'syncing'
  const refreshingHolidays = holidayPhase === 'refreshing'

  async function syncNow(): Promise<void> {
    // Any in-flight action (not just a sync) blocks this: its own `finally` would
    // otherwise be pre-empted by ours resetting `busy`.
    if (busy !== null || syncPhase === 'syncing') return
    const { setBusy, setStatus } = useSyncStore.getState()
    setBusy('sync')
    try {
      setStatus(await api.google.syncNow())
    } finally {
      setBusy(null)
    }
  }

  async function refreshHolidays(): Promise<void> {
    if (refreshingHolidays) return
    const { holidayStatus, setHolidayStatus } = useSyncStore.getState()
    // Main pushes 'refreshing' too, but show it without waiting on that round trip.
    setHolidayStatus({ ...holidayStatus, phase: 'refreshing' })
    setHolidayStatus(await api.holidays.refreshNow())
  }

  return { syncing, syncNow, refreshingHolidays, refreshHolidays }
}

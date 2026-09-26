import { useEffect } from 'react'
import { useApi } from './apiContext'
import { useSyncStore } from './syncStore'
import { useNotificationStore } from './notificationStore'
import { useAppStore } from './store'
import { clearHolidayCache } from './useHolidays'

/** Mounted once in App: the renderer's one subscriber to main's push channels. Pulls the
 *  current state on mount (the renderer may mount after an early push), then keeps the
 *  stores current. A data change bumps dataVersion so open views refetch without a
 *  manual navigation. */
export function useMainBridge(): void {
  const api = useApi()

  useEffect(() => {
    const { setStatus, setHolidayStatus, openSettings } = useSyncStore.getState()
    const { setItems } = useNotificationStore.getState()
    const { bumpDataVersion } = useAppStore.getState()
    let cancelled = false
    const ifLive =
      <T,>(fn: (v: T) => void) =>
      (v: T) => {
        if (!cancelled) fn(v)
      }
    const reloadNotifications = () => void api.notifications.list().then(ifLive(setItems))

    void api.google.status().then(ifLive(setStatus))
    void api.holidays.status().then(ifLive(setHolidayStatus))
    reloadNotifications()

    const unsubscribers = [
      api.google.onStatus(setStatus),
      api.google.onEventsChanged(() => bumpDataVersion()),
      api.holidays.onStatus(setHolidayStatus),
      api.holidays.onChanged(() => {
        clearHolidayCache()
        bumpDataVersion()
      }),
      api.notifications.onChanged(reloadNotifications),
      api.settings.onOpenRequest((section) => openSettings(section))
    ]
    return () => {
      cancelled = true
      unsubscribers.forEach((unsub) => unsub())
    }
  }, [api])
}

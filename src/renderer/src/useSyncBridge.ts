import { useEffect } from 'react'
import { useApi } from './apiContext'
import { useSyncStore } from './syncStore'
import { useAppStore } from './store'

/** Mounted once in App. Pulls the current status on mount (the renderer may mount after
 *  an early push) then subscribes to the push channel; bumps dataVersion so open views
 *  refetch after a pull changes local data. */
export function useSyncBridge(): void {
  const api = useApi()
  const setStatus = useSyncStore((s) => s.setStatus)
  const bumpDataVersion = useAppStore((s) => s.bumpDataVersion)

  useEffect(() => {
    let cancelled = false
    api.google.status().then((s) => {
      if (!cancelled) setStatus(s)
    })
    const unsubStatus = api.google.onStatus((s) => setStatus(s))
    const unsubChanged = api.google.onEventsChanged(() => bumpDataVersion())
    return () => {
      cancelled = true
      unsubStatus()
      unsubChanged()
    }
  }, [api, setStatus, bumpDataVersion])
}

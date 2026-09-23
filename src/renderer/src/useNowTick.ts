import { useEffect, useState } from 'react'

/** Re-renders every `intervalMs` with the current time, for the "now" line and scroll anchoring. */
export function useNowTick(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

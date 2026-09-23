import { useEffect, useState } from 'react'
import type { DayInfo } from '@shared/types'
import type { JalaliDate } from '@shared/jalali'
import { useApi } from './apiContext'

export interface HolidayLookup {
  get(d: Pick<JalaliDate, 'jm' | 'jd'>): DayInfo | undefined
}

const cache = new Map<number, HolidayLookup>()

/** Loads and memoizes a Jalali year's holiday info, keyed by (month, day). */
export function useHolidays(jy: number): HolidayLookup | undefined {
  const api = useApi()
  const [, force] = useState(0)

  useEffect(() => {
    if (cache.has(jy)) return
    let cancelled = false
    api.holidays.year(jy).then((rows) => {
      if (cancelled) return
      const map = new Map<string, DayInfo>()
      for (const r of rows) map.set(`${r.jm}-${r.jd}`, r.info)
      cache.set(jy, { get: (d) => map.get(`${d.jm}-${d.jd}`) })
      force((x) => x + 1)
    })
    return () => {
      cancelled = true
    }
  }, [api, jy])

  return cache.get(jy)
}

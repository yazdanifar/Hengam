import React, { createContext, useContext } from 'react'
import type { HengamApi } from '@shared/api'

declare global {
  interface Window {
    api: HengamApi
  }
}

const ApiContext = createContext<HengamApi | null>(null)

export function ApiProvider({ api, children }: { api: HengamApi; children: React.ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

export function useApi(): HengamApi {
  const ctx = useContext(ApiContext)
  if (ctx) return ctx
  // Outside tests, App is always wrapped in ApiProvider with window.api; this fallback
  // just keeps components usable in isolation without extra boilerplate.
  return window.api
}

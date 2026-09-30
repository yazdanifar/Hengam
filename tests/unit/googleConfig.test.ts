import { describe, expect, it } from 'vitest'
import { loadGoogleConfig } from '@main/sync/googleConfig'

describe('loadGoogleConfig', () => {
  it('returns null when neither client id nor secret is set', () => {
    expect(loadGoogleConfig({}, undefined)).toBeNull()
  })

  it('returns null when only one of id/secret is set', () => {
    expect(loadGoogleConfig({ HENGAM_GOOGLE_CLIENT_ID: 'id' }, undefined)).toBeNull()
    expect(loadGoogleConfig({ HENGAM_GOOGLE_CLIENT_SECRET: 'secret' }, undefined)).toBeNull()
  })

  it('prefers process.env over import.meta.env', () => {
    const cfg = loadGoogleConfig(
      { HENGAM_GOOGLE_CLIENT_ID: 'env-id', HENGAM_GOOGLE_CLIENT_SECRET: 'env-secret' },
      { MAIN_VITE_GOOGLE_CLIENT_ID: 'meta-id', MAIN_VITE_GOOGLE_CLIENT_SECRET: 'meta-secret' }
    )
    expect(cfg?.clientId).toBe('env-id')
    expect(cfg?.clientSecret).toBe('env-secret')
  })

  it('falls back to import.meta.env when process.env is empty', () => {
    const cfg = loadGoogleConfig({}, { MAIN_VITE_GOOGLE_CLIENT_ID: 'meta-id', MAIN_VITE_GOOGLE_CLIENT_SECRET: 'meta-secret' })
    expect(cfg?.clientId).toBe('meta-id')
    expect(cfg?.clientSecret).toBe('meta-secret')
  })

  it('includes the calendar scopes and stable endpoints', () => {
    const cfg = loadGoogleConfig({ HENGAM_GOOGLE_CLIENT_ID: 'id', HENGAM_GOOGLE_CLIENT_SECRET: 'secret' }, undefined)
    expect(cfg?.scopes).toContain('https://www.googleapis.com/auth/calendar.events')
    expect(cfg?.scopes).toContain('https://www.googleapis.com/auth/calendar.calendarlist.readonly')
    expect(cfg?.authEndpoint).toMatch(/^https:\/\/accounts\.google\.com/)
    expect(cfg?.tokenEndpoint).toMatch(/^https:\/\/oauth2\.googleapis\.com/)
  })
})

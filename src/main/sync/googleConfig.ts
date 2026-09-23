// Single read point for the Google OAuth client configuration. Returning `null` (rather
// than throwing) is a first-class state: the Settings UI shows "not configured" and the
// connect button is disabled, matching HolidayService's degrade-never-throw posture.
export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  authEndpoint: string
  tokenEndpoint: string
  revokeEndpoint: string
  apiBase: string
  scopes: string[]
}

const DEFAULT_ENDPOINTS = {
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
  apiBase: 'https://www.googleapis.com/calendar/v3'
}

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar']

/**
 * Resolution order: process.env.HENGAM_GOOGLE_* (lets a developer run without a .env, and
 * lets buildContainer() be exercised in tests) then import.meta.env.MAIN_VITE_GOOGLE_* (the
 * baked-in value electron-vite produces for the packaged build).
 */
export function loadGoogleConfig(
  processEnv: Record<string, string | undefined> = process.env,
  metaEnv: ImportMetaEnv | undefined = safeImportMetaEnv()
): GoogleOAuthConfig | null {
  const clientId = processEnv.HENGAM_GOOGLE_CLIENT_ID || metaEnv?.MAIN_VITE_GOOGLE_CLIENT_ID
  const clientSecret = processEnv.HENGAM_GOOGLE_CLIENT_SECRET || metaEnv?.MAIN_VITE_GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, scopes: SCOPES, ...DEFAULT_ENDPOINTS }
}

function safeImportMetaEnv(): ImportMetaEnv | undefined {
  // import.meta.env is populated by electron-vite in the built main bundle; under vitest
  // it may be absent entirely, so guard rather than assume the shape.
  return (import.meta as { env?: ImportMetaEnv }).env
}

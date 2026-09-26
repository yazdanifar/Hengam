// Payload types shared between main and renderer for the Google sync feature.
// Lives under src/shared because the preload bundle only has the @shared alias.

export type GoogleAuthCode =
  | 'not_configured'
  | 'not_connected'
  | 'reauth_required'
  | 'cancelled'
  | 'denied'
  | 'state_mismatch'
  | 'token_exchange_failed'
  | 'network'

export type SyncErrorCode =
  | GoogleAuthCode
  | 'rate_limited'
  | 'server'
  | 'conflict'
  | 'sync_token_expired'
  | 'unknown'

export type SyncPhase = 'disabled' | 'idle' | 'connecting' | 'syncing' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  connected: boolean
  configured: boolean
  email?: string
  /** epoch ms of the last fully successful run. */
  lastSuccessAt?: number
  /** epoch ms of the first failed run since the last success; unset while healthy. */
  failingSince?: number
  /** Stable code; the renderer owns the Persian text. */
  errorCode?: SyncErrorCode
  progress?: { pushed: number; pulled: number }
}

export interface SyncCalendarDto {
  calendarId: string
  summary: string
  color?: string
  enabled: boolean
  isDefaultTarget: boolean
}

export type HolidayErrorCode = 'network' | 'blocked' | 'server' | 'site_changed' | 'invalid_data' | 'unknown'

export interface HolidayStatus {
  phase: 'idle' | 'refreshing' | 'error'
  /** epoch ms of the last refresh that fetched the current year successfully. */
  lastSuccessAt?: number
  /** epoch ms of the first failed attempt since the last success; unset while healthy. */
  failingSince?: number
  /** epoch ms the next scheduled attempt is due (daily after a success, backing off after a failure). */
  nextAttemptAt?: number
  /** Code of the most recent failure; the renderer owns the Persian text. */
  errorCode?: HolidayErrorCode
}

/** Which tab the settings dialog opens on. */
export type SettingsSection = 'google' | 'holidays'

export interface MainToRendererEvents {
  'sync:status': SyncStatus
  'events:changed': { changedAt: number }
  'holidays:status': HolidayStatus
  /** Holiday data on disk changed; the renderer drops its cached years. */
  'holidays:changed': { changedAt: number }
  /** The notification inbox changed; the renderer refetches the list. */
  'notifications:changed': { changedAt: number }
  /** Main asks the renderer to open settings (e.g. an alert's OS notification was clicked). */
  'settings:open': { section: SettingsSection }
}

export const MAIN_EVENT_CHANNELS = [
  'sync:status',
  'events:changed',
  'holidays:status',
  'holidays:changed',
  'notifications:changed',
  'settings:open'
] as const

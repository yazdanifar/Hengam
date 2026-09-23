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

export interface MainToRendererEvents {
  'sync:status': SyncStatus
  'events:changed': { changedAt: number }
}

export const MAIN_EVENT_CHANNELS = ['sync:status', 'events:changed'] as const

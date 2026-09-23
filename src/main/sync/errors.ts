import type { GoogleAuthCode, SyncErrorCode } from '@shared/events'

export type { GoogleAuthCode, SyncErrorCode }

/** Thrown by GoogleAuth. `detail` is for logs only — never shown to the user or sent over IPC. */
export class GoogleAuthError extends Error {
  constructor(
    public code: GoogleAuthCode,
    public detail?: string
  ) {
    super(`GoogleAuthError(${code})${detail ? `: ${detail}` : ''}`)
    this.name = 'GoogleAuthError'
  }
}

/** Thrown by GoogleCalendarClient / raised by SyncService. */
export class SyncError extends Error {
  constructor(
    public code: SyncErrorCode,
    public detail?: string
  ) {
    super(`SyncError(${code})${detail ? `: ${detail}` : ''}`)
    this.name = 'SyncError'
  }
}

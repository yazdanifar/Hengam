// The sync engine: pushes local dirty rows to Google, then pulls remote changes back.
// Lifecycle discipline mirrors DayTicker (see commit f548e0c): every timer handle is
// stored and cleared, every subscription's unsubscribe is retained, all fields reset in
// stop(), and an AbortController cancels in-flight requests on shutdown.
import type { RecurrenceRule } from '@shared/types'
import type { SyncErrorCode, SyncStatus } from '@shared/events'
import type { Clock, PowerEvents, RendererBridge } from '../ports'
import type { EventsRepo } from '../repo/events'
import type { SyncCalendar, SyncCalendarsRepo } from '../repo/syncCalendars'
import type { MetaRepo } from '../repo/meta'
import type { GoogleAuth } from './GoogleAuth'
import type { GoogleCalendarClient, GoogleEventResource } from './GoogleCalendarClient'
import { fromGoogleEvent, toGoogleEvent } from './mapper'
import { colorIdForHex, hexForColorId } from './colorMap'
import { GoogleAuthError, SyncError } from './errors'
import { DEFAULT_EVENT_COLOR } from '../db'

const TIMER_INTERVAL_MS = 5 * 60_000
const HENGAM_ID_PROP = 'hengamId'
const YEAR_MS = 365 * 24 * 60 * 60 * 1000

export type SyncTrigger = 'launch' | 'timer' | 'wake' | 'manual' | 'local-change'

function errorCodeOf(err: unknown): SyncErrorCode {
  if (err instanceof GoogleAuthError) return err.code
  if (err instanceof SyncError) return err.code
  return 'unknown'
}

export class SyncService {
  private timer: unknown
  private unsubResume?: () => void
  private unsubUnlock?: () => void
  private abort?: AbortController
  private running: Promise<SyncStatus> | null = null
  private rerunRequested = false
  // Only true after stop() runs. A freshly constructed service (before start() is ever
  // called) must still allow syncNow() — e.g. a manual "Sync now" — to work normally,
  // including its queued-rerun mechanism, so this defaults to false rather than true.
  private stopped = false
  private status: SyncStatus

  constructor(
    private clock: Clock,
    private power: PowerEvents,
    private auth: GoogleAuth,
    private client: GoogleCalendarClient,
    private events: EventsRepo,
    private calendars: SyncCalendarsRepo,
    private meta: MetaRepo,
    private bridge: RendererBridge,
    private configured: boolean
  ) {
    this.status = { phase: configured ? 'idle' : 'disabled', connected: false, configured }
  }

  start(): void {
    this.stopped = false
    this.unsubResume = this.power.onResume(() => void this.syncNow('wake'))
    this.unsubUnlock = this.power.onUnlockScreen(() => void this.syncNow('wake'))
    this.armTimer()
    void this.syncNow('launch')
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.unsubResume?.()
    this.unsubUnlock?.()
    this.abort?.abort()
    this.timer = undefined
    this.unsubResume = undefined
    this.unsubUnlock = undefined
  }

  private armTimer(): void {
    this.timer = this.clock.setTimeout(() => {
      void this.syncNow('timer')
      this.armTimer()
    }, TIMER_INTERVAL_MS)
  }

  getStatus(): SyncStatus {
    return this.status
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    this.bridge.send('sync:status', this.status)
  }

  syncNow(trigger: SyncTrigger): Promise<SyncStatus> {
    if (this.running) {
      if (trigger === 'manual' || trigger === 'local-change') this.rerunRequested = true
      return this.running
    }
    this.running = this.runOnce(trigger).finally(() => {
      this.running = null
      if (this.rerunRequested && !this.stopped) {
        this.rerunRequested = false
        void this.syncNow('manual')
      }
    })
    return this.running
  }

  private async runOnce(_trigger: SyncTrigger): Promise<SyncStatus> {
    if (!this.status.configured) {
      this.setStatus({ phase: 'disabled' })
      return this.status
    }
    const connected = await this.auth.isConnected()
    if (!connected) {
      this.setStatus({ phase: 'idle', connected: false, errorCode: undefined })
      return this.status
    }
    const enabled = this.calendars.listEnabled()
    if (enabled.length === 0) {
      this.setStatus({ phase: 'idle', connected: true, errorCode: undefined })
      return this.status
    }

    this.abort = new AbortController()
    const signal = this.abort.signal
    this.setStatus({ phase: 'syncing', connected: true, errorCode: undefined })

    let pushed = 0
    let pulled = 0
    try {
      pushed = await this.pushAll(signal)
      pulled = await this.pullAll(enabled, signal)
      const email = await this.auth.getEmail()
      this.setStatus({
        phase: 'idle',
        connected: true,
        email,
        lastSuccessAt: this.clock.now(),
        errorCode: undefined,
        progress: { pushed, pulled }
      })
      this.bridge.send('events:changed', { changedAt: this.clock.now() })
    } catch (err) {
      const code = errorCodeOf(err)
      console.error('[sync] run failed', err)
      this.meta.set('sync.lastErrorCode', code)
      this.setStatus({ phase: 'error', errorCode: code, progress: { pushed, pulled } })
    } finally {
      this.abort = undefined
    }
    return this.status
  }

  // ---- connect / disconnect / calendars -------------------------------------

  async connect(): Promise<SyncStatus> {
    if (!this.status.configured) return this.status
    this.setStatus({ phase: 'connecting' })
    this.abort = new AbortController()
    try {
      const result = await this.auth.connect(this.abort.signal)
      // The auth handshake itself succeeded — report connected now, before touching the
      // calendar list, so a failure in refreshCalendars() (e.g. a transient API error)
      // doesn't get mis-reported as "never connected" when a refresh token was in fact stored.
      this.setStatus({ phase: 'idle', connected: true, email: result.email, errorCode: undefined })
      try {
        await this.refreshCalendars()
      } catch (err) {
        console.error('[sync] connect: fetching the calendar list failed after a successful auth', err)
        this.setStatus({ errorCode: errorCodeOf(err) })
      }
      void this.syncNow('manual')
    } catch (err) {
      console.error('[sync] connect failed', err)
      this.setStatus({ phase: 'idle', connected: false, errorCode: errorCodeOf(err) })
    } finally {
      this.abort = undefined
    }
    return this.status
  }

  cancelConnect(): void {
    this.abort?.abort()
  }

  async disconnect(): Promise<SyncStatus> {
    await this.auth.disconnect()
    this.calendars.clearAll()
    this.meta.delete('sync.lastSuccessAt')
    this.meta.delete('sync.lastErrorCode')
    // A later reconnect must re-push everything as new rather than PATCH ids that may
    // belong to a different account. Local events themselves are never deleted.
    this.events.clearAllSyncIdentity()
    this.setStatus({ phase: 'idle', connected: false, email: undefined, errorCode: undefined, lastSuccessAt: undefined })
    return this.status
  }

  async refreshCalendars(): Promise<SyncCalendar[]> {
    const remote = await this.client.listCalendars()
    this.calendars.upsertMany(
      remote.map((c) => ({ calendarId: c.id, summary: c.summary, color: c.backgroundColor, primary: c.primary }))
    )
    this.calendars.pruneMissing(remote.map((c) => c.id))
    return this.calendars.list()
  }

  async setCalendarEnabled(id: string, enabled: boolean): Promise<void> {
    this.calendars.setEnabled(id, enabled)
  }

  async setDefaultTarget(id: string): Promise<void> {
    this.calendars.setDefaultTarget(id)
  }

  // ---- push -------------------------------------------------------------------

  private async colorPalette(signal: AbortSignal): Promise<Record<string, { background: string; foreground: string }>> {
    const cached = this.meta.get('sync.colorPalette')
    if (cached) return JSON.parse(cached)
    const palette = await this.client.listColors(signal)
    this.meta.set('sync.colorPalette', JSON.stringify(palette))
    return palette
  }

  private async pushAll(signal: AbortSignal): Promise<number> {
    const target = this.calendars.defaultTarget()
    const palette = await this.colorPalette(signal)
    let count = 0

    for (const row of this.events.listDirty()) {
      try {
        if (row.deletedAt) {
          if (row.calendarId && row.googleId) {
            await this.client.deleteEvent(row.calendarId, row.googleId, row.etag, signal)
          }
          this.events.purgeDeleted(row.id)
          count++
          continue
        }

        const colorId = colorIdForHex(row.color, palette)
        const body = toGoogleEvent({
          title: row.title,
          notes: row.notes,
          startTs: row.startTs,
          endTs: row.endTs,
          allDay: row.allDay,
          rrule: row.rrule,
          reminderMin: row.reminderMin,
          colorId
        })
        body.extendedProperties = {
          private: { ...body.extendedProperties?.private, [HENGAM_ID_PROP]: row.id }
        }

        if (!row.googleId) {
          if (!target) continue // nowhere to push a new event to
          const created = await this.client.insertEvent(target.calendarId, body, signal)
          this.events.markSynced(row.id, {
            calendarId: target.calendarId,
            googleId: created.id,
            etag: created.etag,
            remoteUpdatedAt: created.updated ? new Date(created.updated).getTime() : undefined
          })
        } else {
          try {
            const updated = await this.client.patchEvent(row.calendarId!, row.googleId, body, row.etag, signal)
            this.events.markSynced(row.id, {
              calendarId: row.calendarId!,
              googleId: row.googleId,
              etag: updated.etag,
              remoteUpdatedAt: updated.updated ? new Date(updated.updated).getTime() : undefined
            })
          } catch (err) {
            if (err instanceof SyncError && err.code === 'conflict') {
              await this.resolveConflict(row.id, row.calendarId!, row.googleId, signal)
            } else {
              throw err
            }
          }
        }
        count++
      } catch {
        // one bad row must not abort the pass; it stays dirty and is retried next run
      }
    }

    for (const ex of this.events.listDirtyExceptions()) {
      try {
        // Per-occurrence identity (the Google "instance" id) is only known once it has
        // arrived via a pull (recurringEventId on an instance resource). Until then the
        // exception stays dirty and is retried on a later run, once pull has adopted it.
        if (!ex.googleId) continue
        const parent = this.events.getById(ex.eventId)
        if (!parent?.calendarId) continue

        if (ex.kind === 'skip') {
          await this.client.deleteEvent(parent.calendarId, ex.googleId, ex.etag, signal)
        } else {
          const override = ex.override ?? {}
          const body = toGoogleEvent({
            title: override.title ?? parent.title,
            notes: override.notes ?? parent.notes,
            startTs: override.startTs ?? ex.occurrenceStartTs,
            endTs: override.endTs ?? ex.occurrenceStartTs + (parent.endTs - parent.startTs),
            allDay: parent.allDay
          })
          await this.client.patchEvent(parent.calendarId, ex.googleId, body, ex.etag, signal)
        }
        this.events.markExceptionSynced(ex.eventId, ex.occurrenceStartTs, { googleId: ex.googleId })
      } catch {
        // retried next run
      }
    }

    return count
  }

  private async resolveConflict(localId: string, calendarId: string, googleId: string, signal: AbortSignal): Promise<void> {
    // 412: someone else changed it too. Newer `updated` wins; ties favor the local edit
    // (the one the user can see in this app).
    const remote = await this.client.getEvent(calendarId, googleId, signal).catch(() => undefined)
    if (!remote) return
    const local = this.events.getById(localId)
    if (!local) return
    const remoteUpdated = remote.updated ? new Date(remote.updated).getTime() : 0
    if (remoteUpdated > (local.updatedAt ?? 0)) {
      const mapped = fromGoogleEvent(remote)
      this.events.upsertFromRemote({
        calendarId,
        googleId,
        etag: remote.etag,
        remoteUpdatedAt: remoteUpdated,
        local: { title: mapped.title, notes: mapped.notes, color: local.color, startTs: mapped.startTs, endTs: mapped.endTs, allDay: mapped.allDay, rrule: mapped.rrule, reminderMin: mapped.reminderMin }
      })
    } else {
      const updated = await this.client.patchEvent(calendarId, googleId, toGoogleEvent(local), undefined, signal)
      this.events.markSynced(localId, {
        calendarId,
        googleId,
        etag: updated.etag,
        remoteUpdatedAt: updated.updated ? new Date(updated.updated).getTime() : undefined
      })
    }
  }

  // ---- pull -------------------------------------------------------------------

  private async pullAll(enabled: SyncCalendar[], signal: AbortSignal): Promise<number> {
    const palette = await this.colorPalette(signal)
    let count = 0
    for (const cal of enabled) {
      count += await this.pullCalendar(cal, palette, signal)
    }
    return count
  }

  private async pullCalendar(
    cal: SyncCalendar,
    palette: Record<string, { background: string; foreground: string }>,
    signal: AbortSignal
  ): Promise<number> {
    let count = 0
    let pageToken: string | undefined
    let syncToken = cal.syncToken
    let usingFreshWindow = !syncToken

    for (;;) {
      let page
      try {
        page = await this.client.listEvents(
          cal.calendarId,
          {
            syncToken,
            timeMin: usingFreshWindow ? new Date(this.clock.now() - YEAR_MS).toISOString() : undefined,
            pageToken,
            maxResults: 250
          },
          signal
        )
      } catch (err) {
        if (err instanceof SyncError && err.code === 'sync_token_expired') {
          this.calendars.setSyncToken(cal.calendarId, undefined)
          syncToken = undefined
          pageToken = undefined
          usingFreshWindow = true
          continue
        }
        throw err
      }

      count += this.applyPage(cal.calendarId, page.items, palette)

      if (page.nextSyncToken) {
        this.calendars.setSyncToken(cal.calendarId, page.nextSyncToken)
        break
      }
      if (!page.nextPageToken) break
      pageToken = page.nextPageToken
    }
    return count
  }

  private applyPage(
    calendarId: string,
    items: GoogleEventResource[],
    palette: Record<string, { background: string; foreground: string }>
  ): number {
    let count = 0
    for (const item of items) {
      const remoteUpdatedAt = item.updated ? new Date(item.updated).getTime() : this.clock.now()

      if (item.recurringEventId) {
        const parent = this.events.findByGoogleId(calendarId, item.recurringEventId)
        if (!parent) continue // parent hasn't arrived yet; will be reconciled on a later pull
        const occurrenceStartTs = item.originalStartTime
          ? new Date(item.originalStartTime.dateTime ?? `${item.originalStartTime.date}T00:00:00`).getTime()
          : remoteUpdatedAt
        if (item.status === 'cancelled') {
          this.events.upsertExceptionFromRemote({
            eventId: parent.id,
            occurrenceStartTs,
            kind: 'skip',
            googleId: item.id,
            remoteUpdatedAt
          })
        } else {
          const mapped = fromGoogleEvent(item)
          this.events.upsertExceptionFromRemote({
            eventId: parent.id,
            occurrenceStartTs,
            kind: 'override',
            override: { title: mapped.title, notes: mapped.notes, startTs: mapped.startTs, endTs: mapped.endTs },
            googleId: item.id,
            etag: item.etag,
            remoteUpdatedAt
          })
        }
        count++
        continue
      }

      if (item.status === 'cancelled') {
        this.events.deleteByGoogleId(calendarId, item.id)
        count++
        continue
      }

      const mapped = fromGoogleEvent(item)
      const color = hexForColorId(mapped.colorId, palette, DEFAULT_EVENT_COLOR)
      const hengamId = item.extendedProperties?.private?.[HENGAM_ID_PROP]

      this.events.upsertFromRemote({
        calendarId,
        googleId: item.id,
        etag: item.etag,
        remoteUpdatedAt,
        local: {
          title: mapped.title,
          notes: mapped.notes,
          color,
          startTs: mapped.startTs,
          endTs: mapped.endTs,
          allDay: mapped.allDay,
          rrule: mapped.rrule,
          reminderMin: mapped.reminderMin
        },
        adoptLocalId: hengamId
      })
      count++
    }
    return count
  }
}

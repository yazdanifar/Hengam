// The sync engine: pushes local dirty rows to Google, then pulls remote changes back.
// Lifecycle discipline mirrors DayTicker (see commit f548e0c): every timer handle is
// stored and cleared, every subscription's unsubscribe is retained, all fields reset in
// stop(), and an AbortController cancels in-flight requests on shutdown.
import { createHash } from 'node:crypto'
import type { SyncErrorCode, SyncStatus } from '@shared/events'
import type { EventRecord } from '@shared/types'
import type { Clock, PowerEvents, RendererBridge } from '../ports'
import type { EventsRepo } from '../repo/events'
import type { SyncCalendar, SyncCalendarsRepo } from '../repo/syncCalendars'
import type { MetaRepo } from '../repo/meta'
import type { GoogleAuth } from './GoogleAuth'
import type { GoogleCalendarClient, GoogleEventResource } from './GoogleCalendarClient'
import { fromGoogleEvent, jalaliSkippedStarts, originalStartFor, toGoogleEvent, type GoogleEventLike } from './mapper'
import { colorIdForHex, hexForColorId } from './colorMap'
import { GoogleAuthError, SyncError } from './errors'
import { DEFAULT_EVENT_COLOR } from '../db'

const TIMER_INTERVAL_MS = 5 * 60_000
const HENGAM_ID_PROP = 'hengamId'
const YEAR_MS = 365 * 24 * 60 * 60 * 1000
// Ids tried per event: normally only the first. A later one is used only when an earlier
// one is taken by a copy that has since been deleted on Google (ids are never reusable).
const MAX_INSERT_IDS = 5
const IDENTITY_ACCOUNT_KEY = 'sync.identityAccount'

export type SyncTrigger = 'launch' | 'timer' | 'wake' | 'manual' | 'local-change'

/**
 * The Google event id a local event is inserted under. Derived from the local id, so
 * re-sending an insert whose response was lost hits a 409 instead of creating a second
 * copy. Google ids allow base32hex (0-9, a-v), 5-1024 chars; a UUID minus dashes qualifies.
 */
export function googleIdFor(localId: string, attempt = 0): string {
  const hex = localId.replace(/-/g, '').toLowerCase()
  const base = /^[0-9a-f]{32}$/.test(hex) ? hex : createHash('sha256').update(localId).digest('hex').slice(0, 32)
  return attempt === 0 ? base : `${base}v${attempt}`
}

function errorCodeOf(err: unknown): SyncErrorCode {
  if (err instanceof GoogleAuthError) return err.code
  if (err instanceof SyncError) return err.code
  return 'unknown'
}

/** Monthly/yearly series are Jalali and go to Google as an RDATE list, not an RRULE. */
function isJalaliSeries(ev: EventRecord): boolean {
  return ev.rrule?.freq === 'monthly' || ev.rrule?.freq === 'yearly'
}

export class SyncService {
  private timer: unknown
  private unsubResume?: () => void
  private unsubUnlock?: () => void
  private abort?: AbortController
  private running: Promise<SyncStatus> | null = null
  private rerunRequested = false
  // Set while connect()/disconnect() swap which account local events are linked to; a run
  // that started then would push against half-switched identity.
  private switchingAccount = false
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
    // Both survive restarts, so "last synced" and a failure's age don't reset on relaunch.
    this.status = {
      phase: configured ? 'idle' : 'disabled',
      connected: false,
      configured,
      lastSuccessAt: meta.getNumber('sync.lastSuccessAt'),
      failingSince: meta.getNumber('sync.failingSince')
    }
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

  /** Ends the current failure episode, if any; the next setStatus carries it to the renderer. */
  private clearFailure(): void {
    this.meta.delete('sync.failingSince')
    this.status = { ...this.status, failingSince: undefined }
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
    if (this.switchingAccount) return this.status
    if (!this.status.configured) {
      this.setStatus({ phase: 'disabled' })
      return this.status
    }
    const connected = await this.auth.isConnected()
    if (!connected) {
      // Nothing to sync is not a failure: an old failure episode ends here.
      this.clearFailure()
      this.setStatus({ phase: 'idle', connected: false, errorCode: undefined })
      return this.status
    }
    const enabled = this.calendars.listEnabled()
    if (enabled.length === 0) {
      this.clearFailure()
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
      // Installs that predate identity tracking learn whose ids they hold here.
      if (email && this.meta.get(IDENTITY_ACCOUNT_KEY) === undefined) {
        this.meta.set(IDENTITY_ACCOUNT_KEY, email.toLowerCase())
      }
      const lastSuccessAt = this.clock.now()
      this.meta.setNumber('sync.lastSuccessAt', lastSuccessAt)
      this.clearFailure()
      this.setStatus({
        phase: 'idle',
        connected: true,
        email,
        lastSuccessAt,
        errorCode: undefined,
        progress: { pushed, pulled }
      })
      this.bridge.send('events:changed', { changedAt: this.clock.now() })
    } catch (err) {
      const code = errorCodeOf(err)
      console.error('[sync] run failed', err)
      this.meta.set('sync.lastErrorCode', code)
      const failingSince = this.status.failingSince ?? this.clock.now()
      this.meta.setNumber('sync.failingSince', failingSince)
      this.setStatus({ phase: 'error', errorCode: code, failingSince, progress: { pushed, pulled } })
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
    this.switchingAccount = true
    try {
      const result = await this.auth.connect(this.abort.signal)
      this.linkIdentityTo(result.email)
      this.switchingAccount = false
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
      this.switchingAccount = false
      this.abort = undefined
    }
    return this.status
  }

  /**
   * Points local events' Google identity at `email`'s account. Ids held for a different
   * account are set aside for it; ids previously set aside for this one are restored. Doing
   * this, instead of dropping identity, is what keeps a reconnect from re-inserting (and
   * then re-pulling) every event.
   */
  private linkIdentityTo(email: string | undefined): void {
    const account = email?.toLowerCase()
    const owner = this.meta.get(IDENTITY_ACCOUNT_KEY)
    if (owner !== undefined && owner !== account) this.events.stashSyncIdentity(owner)
    if (account === undefined) {
      this.meta.delete(IDENTITY_ACCOUNT_KEY)
      return
    }
    if (owner !== account) this.events.restoreSyncIdentity(account)
    this.meta.set(IDENTITY_ACCOUNT_KEY, account)
  }

  cancelConnect(): void {
    this.abort?.abort()
  }

  async disconnect(): Promise<SyncStatus> {
    this.switchingAccount = true
    try {
      // Let an in-flight run finish (or abort) before its ids are set aside.
      this.rerunRequested = false
      this.abort?.abort()
      await this.running?.catch(() => undefined)
      const owner = this.meta.get(IDENTITY_ACCOUNT_KEY) ?? (await this.auth.getEmail())?.toLowerCase()
      await this.auth.disconnect()
      this.calendars.clearAll()
      this.meta.delete('sync.lastSuccessAt')
      this.meta.delete('sync.lastErrorCode')
      this.clearFailure()
      // A later connect must not PATCH ids that may belong to a different account, so
      // identity is stripped — but kept aside for this account, to be restored if it's the
      // one that reconnects. Local events themselves are never deleted.
      if (owner) this.events.stashSyncIdentity(owner)
      else this.events.clearAllSyncIdentity()
      this.meta.delete(IDENTITY_ACCOUNT_KEY)
    } finally {
      this.switchingAccount = false
    }
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
          } else if (row.calendarId) {
            // An insert was attempted and may have landed without us hearing back.
            await this.deleteUnconfirmedInsert(row.calendarId, row.id, signal)
          }
          this.events.purgeDeleted(row.id)
          count++
          continue
        }

        const body = this.eventBody(row, palette)

        if (!row.googleId) {
          // A retry goes to the calendar the first attempt went to, unless that calendar is gone.
          const calendarId =
            row.calendarId && this.calendars.get(row.calendarId) ? row.calendarId : target?.calendarId
          if (!calendarId) continue // nowhere to push a new event to
          if (row.calendarId !== calendarId) this.events.setPendingInsertCalendar(row.id, calendarId)
          const created = await this.insertIdempotent(calendarId, row.id, body, signal)
          this.events.markSynced(row.id, {
            calendarId,
            googleId: created.id,
            etag: created.etag,
            remoteUpdatedAt: created.updated ? new Date(created.updated).getTime() : undefined,
            expectedEditSeq: row.editSeq
          })
        } else {
          try {
            const updated = await this.client.patchEvent(row.calendarId!, row.googleId, body, row.etag, signal)
            this.events.markSynced(row.id, {
              calendarId: row.calendarId!,
              googleId: row.googleId,
              etag: updated.etag,
              remoteUpdatedAt: updated.updated ? new Date(updated.updated).getTime() : undefined,
              expectedEditSeq: row.editSeq
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
        const parent = this.events.getById(ex.eventId)
        // Not yet pushed, or gone: nothing to attach this occurrence's change to. Retried
        // once the parent itself has a Google identity.
        if (!parent?.calendarId || !parent.googleId || parent.deletedAt) continue

        let googleId = ex.googleId
        let etag = ex.etag
        if (!googleId) {
          // The instance id is normally only known once it has arrived via a pull. Look it
          // up directly instead of waiting for one, so a purely local occurrence edit still
          // reaches Google on this run.
          let instance = await this.client.getInstance(
            parent.calendarId,
            parent.googleId,
            originalStartFor(ex.occurrenceStartTs, parent.allDay),
            signal
          )
          if (!instance && ex.kind === 'override' && isJalaliSeries(parent)) {
            // The date is missing from the parent's RDATE list on Google — skipped on another
            // device while this one edited it. The unpushed local edit wins, as everywhere
            // else: re-push the parent with its full local date list to bring the date back,
            // then patch that restored occurrence.
            const restored = await this.client.patchEvent(
              parent.calendarId,
              parent.googleId,
              this.eventBody(parent, palette),
              parent.etag,
              signal
            )
            this.events.markSynced(parent.id, {
              calendarId: parent.calendarId,
              googleId: parent.googleId,
              etag: restored.etag,
              remoteUpdatedAt: restored.updated ? new Date(restored.updated).getTime() : undefined,
              expectedEditSeq: parent.editSeq
            })
            instance = await this.client.getInstance(
              parent.calendarId,
              parent.googleId,
              originalStartFor(ex.occurrenceStartTs, parent.allDay),
              signal
            )
          }
          if (!instance) {
            // Google has no such occurrence (e.g. outside the Jalali RDATE window, or the
            // rule no longer produces it) — nothing to delete or patch. Stop retrying.
            this.events.markExceptionSynced(ex.eventId, ex.occurrenceStartTs, {
              googleId: '',
              expectedEditSeq: ex.editSeq
            })
            count++
            continue
          }
          googleId = instance.id
          etag = instance.etag
        }

        if (ex.kind === 'skip') {
          await this.client.deleteEvent(parent.calendarId, googleId, etag, signal)
          this.events.markExceptionSynced(ex.eventId, ex.occurrenceStartTs, { googleId, expectedEditSeq: ex.editSeq })
        } else {
          const override = ex.override ?? {}
          const colorId = colorIdForHex(parent.color, palette)
          const body = toGoogleEvent({
            title: override.title ?? parent.title,
            notes: override.notes ?? parent.notes,
            startTs: override.startTs ?? ex.occurrenceStartTs,
            endTs: override.endTs ?? ex.occurrenceStartTs + (parent.endTs - parent.startTs),
            allDay: parent.allDay,
            reminders: parent.reminders,
            colorId
          })
          // 'confirmed' also restores an occurrence cancelled on Google since this edit was
          // made: the unpushed local edit wins over that remote delete.
          const updated = await this.client.patchEvent(
            parent.calendarId,
            googleId,
            { ...body, status: 'confirmed' },
            etag,
            signal
          )
          this.events.markExceptionSynced(ex.eventId, ex.occurrenceStartTs, {
            googleId,
            etag: updated.etag,
            expectedEditSeq: ex.editSeq
          })
        }
        count++
      } catch {
        // retried next run
      }
    }

    return count
  }

  /** The body pushed for a base event: its current local state, with its skipped Jalali
   *  dates left out of the RDATE list and its local id stamped in for identity matching. */
  private eventBody(
    row: EventRecord,
    palette: Record<string, { background: string; foreground: string }>
  ): GoogleEventLike {
    const skipStarts = this.events
      .listExceptions(row.id)
      .filter((ex) => ex.kind === 'skip')
      .map((ex) => ex.occurrenceStartTs)
    const body = toGoogleEvent({
      title: row.title,
      notes: row.notes,
      startTs: row.startTs,
      endTs: row.endTs,
      allDay: row.allDay,
      rrule: row.rrule,
      reminders: row.reminders,
      colorId: colorIdForHex(row.color, palette),
      skipStarts
    })
    body.extendedProperties = {
      private: { ...body.extendedProperties?.private, [HENGAM_ID_PROP]: row.id }
    }
    return body
  }

  /**
   * Inserts under an id derived from the local id. A 409 means that id is taken: if by our
   * own earlier insert (its response lost), that copy is updated and adopted instead of
   * creating another; if by a copy since deleted on Google, the next derived id is tried.
   */
  private async insertIdempotent(
    calendarId: string,
    localId: string,
    body: GoogleEventLike,
    signal: AbortSignal
  ): Promise<GoogleEventResource> {
    for (let attempt = 0; attempt < MAX_INSERT_IDS; attempt++) {
      const id = googleIdFor(localId, attempt)
      try {
        return await this.client.insertEvent(calendarId, { ...body, id }, signal)
      } catch (err) {
        if (!(err instanceof SyncError && err.code === 'conflict')) throw err
      }
      const existing = await this.client.getEvent(calendarId, id, signal)
      if (existing && existing.status !== 'cancelled' && existing.extendedProperties?.private?.[HENGAM_ID_PROP] === localId) {
        return this.client.patchEvent(calendarId, id, body, existing.etag, signal)
      }
    }
    throw new SyncError('unknown', `no free event id for ${localId} in ${calendarId}`)
  }

  /** Deletes whatever an unconfirmed insert may have created, walking the derived ids in
   *  the order insertIdempotent uses them; the first never-used id ends the walk. */
  private async deleteUnconfirmedInsert(calendarId: string, localId: string, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < MAX_INSERT_IDS; attempt++) {
      const existed = await this.client.deleteEvent(calendarId, googleIdFor(localId, attempt), undefined, signal)
      if (!existed) return
    }
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
        local: { title: mapped.title, notes: mapped.notes, color: local.color, startTs: mapped.startTs, endTs: mapped.endTs, allDay: mapped.allDay, rrule: mapped.rrule, reminders: mapped.reminders },
        // Already decided remote is newer than this dirty row; overwrite it despite that.
        forceOverwriteDirty: true
      })
      this.applyRemoteJalaliSkips(localId, remote)
    } else {
      const skipStarts = this.events
        .listExceptions(localId)
        .filter((ex) => ex.kind === 'skip')
        .map((ex) => ex.occurrenceStartTs)
      const updated = await this.client.patchEvent(calendarId, googleId, toGoogleEvent({ ...local, skipStarts }), undefined, signal)
      this.events.markSynced(localId, {
        calendarId,
        googleId,
        etag: updated.etag,
        remoteUpdatedAt: updated.updated ? new Date(updated.updated).getTime() : undefined,
        expectedEditSeq: local.editSeq
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

      const localId = this.events.upsertFromRemote({
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
          reminders: mapped.reminders
        },
        adoptLocalId: hengamId
      })
      this.applyRemoteJalaliSkips(localId, item)
      count++
    }
    return count
  }

  /** A Jalali monthly/yearly occurrence deleted elsewhere (another Hengam device) reaches
   *  Google only as a date missing from the parent's RDATE list — Google has no cancelled
   *  instance to report for it. Record each such date as a local skip, so this device hides
   *  it too and its own later re-push of the parent doesn't put the date back. */
  private applyRemoteJalaliSkips(localId: string, remote: GoogleEventLike): void {
    for (const occurrenceStartTs of jalaliSkippedStarts(remote)) {
      this.events.upsertExceptionFromRemote({ eventId: localId, occurrenceStartTs, kind: 'skip', googleId: '' })
    }
  }
}

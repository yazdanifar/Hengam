import { describe, expect, it } from 'vitest'
import { createTestDb, withRollback } from '../support/db'
import { NotificationsRepo } from '@main/repo/notifications'
import { MetaRepo } from '@main/repo/meta'
import { AlertSettingsRepo } from '@main/repo/alertSettings'
import { DEFAULT_ALERT_SETTINGS, MAX_ALERT_MIN } from '@shared/notifications'

const db = createTestDb()
withRollback(() => db)
const repo = new NotificationsRepo(db)
const DAY = 86_400_000

const reminder = (createdAt: number, title = 'جلسه') =>
  repo.addReminder({ title, body: '۱۰:۰۰ — ۱۰ دقیقه دیگر', eventStartTs: createdAt + 600_000, createdAt })

describe('NotificationsRepo', () => {
  it('stores reminders and alerts and lists them newest first', () => {
    const r = reminder(1000)
    const a = repo.addAlert('sync_failure', 500, 2000)
    expect(repo.list().map((n) => n.id)).toEqual([a.id, r.id])
    expect(r).toEqual({
      id: r.id,
      kind: 'reminder',
      createdAt: 1000,
      readAt: undefined,
      resolvedAt: undefined,
      title: 'جلسه',
      body: '۱۰:۰۰ — ۱۰ دقیقه دیگر',
      eventStartTs: 601_000,
      failingSince: undefined
    })
    expect(a).toMatchObject({ kind: 'sync_failure', failingSince: 500, title: '', body: undefined })
  })

  it('tracks one active alert per kind until it is resolved', () => {
    repo.addAlert('sync_failure', 1, 10)
    expect(repo.activeAlert('sync_failure')).toBeDefined()
    expect(repo.activeAlert('holiday_failure')).toBeUndefined()

    expect(repo.resolveAlert('sync_failure', 99)).toBe(true)
    expect(repo.resolveAlert('sync_failure', 100)).toBe(false) // nothing left to resolve
    expect(repo.activeAlert('sync_failure')).toBeUndefined()
    expect(repo.list()[0].resolvedAt).toBe(99)
  })

  it('marks everything read once, reporting whether anything changed', () => {
    reminder(1)
    reminder(2)
    expect(repo.markAllRead(50)).toBe(true)
    expect(repo.list().every((n) => n.readAt === 50)).toBe(true)
    expect(repo.markAllRead(60)).toBe(false)
  })

  it('dismisses reminders and resolved alerts, but never an active alert', () => {
    const r = reminder(1)
    const active = repo.addAlert('holiday_failure', 1, 2)
    expect(repo.dismiss(active.id)).toBe(false)
    expect(repo.dismiss(r.id)).toBe(true)
    expect(repo.dismiss(r.id)).toBe(false)

    repo.resolveAlert('holiday_failure', 3)
    expect(repo.dismiss(active.id)).toBe(true)
    expect(repo.list()).toEqual([])
  })

  it('clears everything except active alerts', () => {
    reminder(1)
    repo.addAlert('sync_failure', 1, 2)
    repo.resolveAlert('sync_failure', 3)
    const active = repo.addAlert('sync_failure', 4, 5)
    expect(repo.clearAll()).toBe(true)
    expect(repo.list().map((n) => n.id)).toEqual([active.id])
    expect(repo.clearAll()).toBe(false)
  })

  it('prunes entries older than 30 days, keeping active alerts however old', () => {
    const now = 100 * DAY
    reminder(now - 31 * DAY, 'old')
    reminder(now - 29 * DAY, 'recent')
    const oldActive = repo.addAlert('sync_failure', 0, now - 60 * DAY)
    repo.prune(now)
    expect(repo.list().map((n) => n.title || n.id)).toEqual(['recent', oldActive.id])
  })

  it('prunes all but the newest 200 entries', () => {
    for (let i = 0; i < 205; i++) reminder(1_000_000 + i, `r${i}`)
    repo.prune(1_000_000 + 205)
    const left = repo.list()
    expect(left).toHaveLength(200)
    expect(left.at(-1)!.title).toBe('r5')
  })
})

describe('AlertSettingsRepo', () => {
  const settings = new AlertSettingsRepo(new MetaRepo(db))

  it('returns the defaults until something is saved', () => {
    expect(settings.get()).toEqual(DEFAULT_ALERT_SETTINGS)
  })

  it('saves the fields given, normalized, leaving the others alone', () => {
    expect(settings.set({ holidayFailureMin: 2 * 1440 })).toEqual({ ...DEFAULT_ALERT_SETTINGS, holidayFailureMin: 2880 })
    expect(settings.set({ syncFailureMin: 10 ** 9 }).syncFailureMin).toBe(MAX_ALERT_MIN)
    expect(settings.get().holidayFailureMin).toBe(2880)
  })

  it('keeps the current value when given something unusable', () => {
    settings.set({ syncFailureMin: 180 })
    expect(settings.set({ syncFailureMin: Number.NaN }).syncFailureMin).toBe(180)
  })
})

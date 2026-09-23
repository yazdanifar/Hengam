import { describe, expect, it } from 'vitest'
import { createTestDb, withRollback } from '../support/db'
import { SyncCalendarsRepo } from '@main/repo/syncCalendars'

describe('SyncCalendarsRepo', () => {
  const db = createTestDb()
  withRollback(() => db)
  const repo = new SyncCalendarsRepo(db)

  it('upsertMany enables and defaults only the primary calendar on first insert', () => {
    repo.upsertMany([
      { calendarId: 'primary', summary: 'Me', color: '#fff', primary: true },
      { calendarId: 'shared1', summary: 'Shared', color: '#000' }
    ])
    const list = repo.list()
    const primary = list.find((c) => c.calendarId === 'primary')!
    const shared = list.find((c) => c.calendarId === 'shared1')!
    expect(primary.enabled).toBe(true)
    expect(primary.isDefaultTarget).toBe(true)
    expect(shared.enabled).toBe(false)
    expect(shared.isDefaultTarget).toBe(false)
  })

  it('upsertMany on a second call preserves enabled/syncToken/isDefaultTarget but updates summary/color', () => {
    repo.upsertMany([{ calendarId: 'cal1', summary: 'Old name', color: '#111' }])
    repo.setEnabled('cal1', true)
    repo.setSyncToken('cal1', 'token-1')
    repo.setDefaultTarget('cal1')

    repo.upsertMany([{ calendarId: 'cal1', summary: 'New name', color: '#222' }])

    const cal = repo.get('cal1')!
    expect(cal.summary).toBe('New name')
    expect(cal.color).toBe('#222')
    expect(cal.enabled).toBe(true)
    expect(cal.syncToken).toBe('token-1')
    expect(cal.isDefaultTarget).toBe(true)
  })

  it('setDefaultTarget clears any previous default before setting the new one', () => {
    repo.upsertMany([
      { calendarId: 'a', summary: 'A' },
      { calendarId: 'b', summary: 'B' }
    ])
    repo.setDefaultTarget('a')
    repo.setDefaultTarget('b')
    expect(repo.defaultTarget()?.calendarId).toBe('b')
    expect(repo.get('a')?.isDefaultTarget).toBe(false)
  })

  it('listEnabled only returns enabled calendars', () => {
    repo.upsertMany([
      { calendarId: 'on', summary: 'On' },
      { calendarId: 'off', summary: 'Off' }
    ])
    repo.setEnabled('on', true)
    repo.setEnabled('off', false)
    expect(repo.listEnabled().map((c) => c.calendarId)).toEqual(['on'])
  })

  it('pruneMissing removes calendars Google no longer returns', () => {
    repo.upsertMany([
      { calendarId: 'keep', summary: 'Keep' },
      { calendarId: 'gone', summary: 'Gone' }
    ])
    repo.pruneMissing(['keep'])
    expect(repo.list().map((c) => c.calendarId)).toEqual(['keep'])
  })

  it('pruneMissing with an empty keep list clears everything', () => {
    repo.upsertMany([{ calendarId: 'only', summary: 'Only' }])
    repo.pruneMissing([])
    expect(repo.list()).toEqual([])
  })

  it('clearAll removes every row', () => {
    repo.upsertMany([{ calendarId: 'x', summary: 'X' }])
    repo.clearAll()
    expect(repo.list()).toEqual([])
  })

  it('get returns undefined for an unknown calendar', () => {
    expect(repo.get('nope')).toBeUndefined()
  })
})

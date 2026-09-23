import { describe, expect, it } from 'vitest'
import { createTestDb, withRollback } from '../support/db'
import { MetaRepo } from '@main/repo/meta'

describe('MetaRepo', () => {
  const db = createTestDb()
  withRollback(() => db)
  const repo = new MetaRepo(db)

  it('get returns undefined for a missing key', () => {
    expect(repo.get('missing')).toBeUndefined()
    expect(repo.getNumber('missing')).toBeUndefined()
  })

  it('set/get round-trips a string value', () => {
    repo.set('sync.lastErrorCode', 'network')
    expect(repo.get('sync.lastErrorCode')).toBe('network')
  })

  it('set on an existing key overwrites it (upsert)', () => {
    repo.set('k', 'v1')
    repo.set('k', 'v2')
    expect(repo.get('k')).toBe('v2')
  })

  it('setNumber/getNumber round-trips a number', () => {
    repo.setNumber('sync.lastSuccessAt', 1700000000000)
    expect(repo.getNumber('sync.lastSuccessAt')).toBe(1700000000000)
  })

  it('delete removes the key', () => {
    repo.set('k', 'v')
    repo.delete('k')
    expect(repo.get('k')).toBeUndefined()
  })

  it('delete on a missing key does not throw', () => {
    expect(() => repo.delete('never-set')).not.toThrow()
  })
})

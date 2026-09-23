import { describe, expect, it } from 'vitest'
import { formatJalaliDateTime, formatRelativeFa } from '@shared/datetime'

describe('formatRelativeFa', () => {
  const now = new Date('2026-09-23T12:00:00').getTime()

  it('shows "لحظاتی پیش" under a minute', () => {
    expect(formatRelativeFa(now - 30_000, now)).toBe('لحظاتی پیش')
  })

  it('shows "لحظاتی پیش" at exactly 59s', () => {
    expect(formatRelativeFa(now - 59_000, now)).toBe('لحظاتی پیش')
  })

  it('switches to minutes at exactly 60s', () => {
    expect(formatRelativeFa(now - 60_000, now)).toBe('۱ دقیقه پیش')
  })

  it('shows minutes under an hour', () => {
    expect(formatRelativeFa(now - 5 * 60_000, now)).toBe('۵ دقیقه پیش')
  })

  it('switches to hours at exactly 60 minutes', () => {
    expect(formatRelativeFa(now - 60 * 60_000, now)).toBe('۱ ساعت پیش')
  })

  it('shows hours under 24h, at the 23h boundary', () => {
    expect(formatRelativeFa(now - 23 * 60 * 60_000, now)).toBe('۲۳ ساعت پیش')
  })

  it('falls back to the full date past 24h (25h boundary)', () => {
    const result = formatRelativeFa(now - 25 * 60 * 60_000, now)
    expect(result).not.toMatch(/ساعت پیش/)
    expect(result).toMatch(/^دیروز/)
  })
})

describe('formatJalaliDateTime', () => {
  const now = new Date('2026-09-23T12:00:00').getTime()

  it('labels a timestamp on the same Jalali day as "امروز"', () => {
    expect(formatJalaliDateTime(new Date('2026-09-23T08:00:00').getTime(), now)).toMatch(/^امروز /)
  })

  it('labels a timestamp on the previous Jalali day as "دیروز"', () => {
    expect(formatJalaliDateTime(new Date('2026-09-22T08:00:00').getTime(), now)).toMatch(/^دیروز /)
  })

  it('renders the full Jalali date with Persian digits for anything older', () => {
    const result = formatJalaliDateTime(new Date('2026-08-01T08:00:00').getTime(), now)
    expect(result).toContain('ساعت')
    expect(result).not.toMatch(/[0-9]/)
  })
})

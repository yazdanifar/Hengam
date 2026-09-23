import { describe, expect, it } from 'vitest'
import { parseDigits, toFaDigits, formatTime } from '@shared/format'

describe('toFaDigits', () => {
  it('converts latin digits to persian', () => {
    expect(toFaDigits(31)).toBe('۳۱')
    expect(toFaDigits('1405-06-31')).toBe('۱۴۰۵-۰۶-۳۱')
  })
})

describe('parseDigits', () => {
  it('parses persian digits', () => {
    expect(parseDigits('۳۱')).toBe(31)
  })
  it('parses arabic-indic digits', () => {
    expect(parseDigits('٣١')).toBe(31)
  })
  it('parses latin digits', () => {
    expect(parseDigits('31')).toBe(31)
  })
  it('parses mixed digits', () => {
    expect(parseDigits('۳1')).toBe(31)
  })
})

describe('formatTime', () => {
  it('formats with persian digits and zero-padding', () => {
    expect(formatTime(9, 5)).toBe('۰۹:۰۵')
  })
})

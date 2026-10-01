import { describe, expect, it } from 'vitest'
import { GOOGLE_EVENT_COLORS, textColorOn } from '@shared/colors'
import { colorIdForHex } from '@main/sync/colorMap'

const GOOGLE_PALETTE = Object.fromEntries(GOOGLE_EVENT_COLORS.map((c) => [c.id, { background: c.hex }]))

describe('GOOGLE_EVENT_COLORS', () => {
  it('has the 11 Google event colors, each mapping to its own colorId', () => {
    expect(GOOGLE_EVENT_COLORS).toHaveLength(11)
    for (const c of GOOGLE_EVENT_COLORS) {
      expect(colorIdForHex(c.hex, GOOGLE_PALETTE)).toBe(c.id)
    }
  })
})

describe('textColorOn', () => {
  it('uses dark text on pale colors and white text on strong ones', () => {
    expect(textColorOn('#fbd75b')).toBe('#1d1d1d') // Banana
    expect(textColorOn('#e1e1e1')).toBe('#1d1d1d') // Graphite
    expect(textColorOn('#dc2127')).toBe('#ffffff') // Tomato
    expect(textColorOn('#5484ed')).toBe('#1d1d1d') // Blueberry: dark reads better than white
  })
})

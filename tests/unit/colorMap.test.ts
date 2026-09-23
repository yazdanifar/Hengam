import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { colorIdForHex, hexForColorId } from '@main/sync/colorMap'

const PALETTE = {
  '1': { background: '#a4bdfc', foreground: '#1d1d1d' },
  '11': { background: '#dc2127', foreground: '#1d1d1d' },
  '10': { background: '#51b749', foreground: '#1d1d1d' }
}

describe('colorIdForHex', () => {
  it('picks the nearest palette entry for a blue event color', () => {
    expect(colorIdForHex('#3b82f6', PALETTE)).toBe('1')
  })

  it('picks the nearest palette entry for a red event color', () => {
    expect(colorIdForHex('#ef4444', PALETTE)).toBe('11')
  })

  it('throws on an empty palette rather than returning a bogus id', () => {
    expect(() => colorIdForHex('#000000', {})).toThrow()
  })

  it('property: always returns a key present in the palette', () => {
    fc.assert(
      fc.property(fc.hexaString({ minLength: 6, maxLength: 6 }), (hex) => {
        const id = colorIdForHex(`#${hex}`, PALETTE)
        expect(Object.keys(PALETTE)).toContain(id)
      })
    )
  })
})

describe('hexForColorId', () => {
  it('falls back when colorId is undefined', () => {
    expect(hexForColorId(undefined, PALETTE, '#4285f4')).toBe('#4285f4')
  })

  it('falls back when the colorId has no palette entry', () => {
    expect(hexForColorId('999', PALETTE, '#4285f4')).toBe('#4285f4')
  })

  it('returns the palette hex for a known colorId', () => {
    expect(hexForColorId('1', PALETTE, '#4285f4')).toBe('#a4bdfc')
    expect(hexForColorId('11', PALETTE, '#4285f4')).toBe('#dc2127')
  })
})

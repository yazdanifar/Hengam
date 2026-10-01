import { describe, expect, it } from 'vitest'
import { buildIco } from '../../scripts/ico.mjs'

describe('buildIco', () => {
  it('writes a valid ICO header and directory for each image', () => {
    const a = Buffer.from([1, 2, 3])
    const b = Buffer.from([4, 5])
    const ico: Buffer = buildIco([
      { size: 16, data: a },
      { size: 256, data: b }
    ])

    expect(ico.readUInt16LE(2)).toBe(1) // type: icon
    expect(ico.readUInt16LE(4)).toBe(2) // image count
    expect(ico.readUInt8(6)).toBe(16) // first width
    expect(ico.readUInt8(22)).toBe(0) // 256 is stored as 0
    expect(ico.readUInt32LE(6 + 8)).toBe(3) // first image byte length
    expect(ico.readUInt32LE(6 + 12)).toBe(6 + 32) // first image offset
    expect(ico.subarray(6 + 32)).toEqual(Buffer.concat([a, b]))
  })
})

import { describe, expect, it } from 'vitest'
import { renderSmallDayIcon } from '@main/services/DockIconService'

const template =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#fff"/>' +
  '<text x="512" y="512" font-size="{{FONT_SIZE}}">{{DAY}}</text></svg>'

describe('renderSmallDayIcon', () => {
  it('renders a 256px PNG for one- and two-digit days', () => {
    for (const jd of [1, 9, 31]) {
      const png = renderSmallDayIcon(jd, template)
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect(png.readUInt32BE(16)).toBe(256) // IHDR width
    }
  })
})

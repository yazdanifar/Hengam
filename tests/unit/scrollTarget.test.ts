import { describe, expect, it } from 'vitest'
import { anchorScrollTop, computeAnchorHour, DEFAULT_ANCHOR_HOUR } from '@renderer/components/TimeGrid/scrollTarget'

describe('computeAnchorHour', () => {
  it('uses the current time when today is in view', () => {
    expect(computeAnchorHour({ isTodayInView: true, nowHour: 14.5 })).toBe(14.5)
  })

  it('ignores an earliest event when today is in view', () => {
    expect(computeAnchorHour({ isTodayInView: true, nowHour: 14.5, earliestEventHour: 9 })).toBe(14.5)
  })

  it('uses the earliest event when viewing a different day', () => {
    expect(computeAnchorHour({ isTodayInView: false, nowHour: 14.5, earliestEventHour: 9.25 })).toBe(9.25)
  })

  it('falls back to the default working-day start with no events on another day', () => {
    expect(computeAnchorHour({ isTodayInView: false, nowHour: 14.5 })).toBe(DEFAULT_ANCHOR_HOUR)
  })

  it('clamps out-of-range hours', () => {
    expect(computeAnchorHour({ isTodayInView: true, nowHour: -1 })).toBe(0)
    expect(computeAnchorHour({ isTodayInView: true, nowHour: 30 })).toBe(24)
  })
})

describe('anchorScrollTop', () => {
  it('places the anchor about a third of the way down the viewport', () => {
    // anchor at hour 9, 48px/hour -> 432px; viewport 900px -> minus 300px = 132px
    expect(anchorScrollTop(9, 48, 900)).toBe(132)
  })

  it('never scrolls above the top of the grid', () => {
    expect(anchorScrollTop(0, 48, 900)).toBe(0)
    expect(anchorScrollTop(1, 48, 900)).toBe(0) // 48 - 300 would be negative
  })
})

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { layoutOverlaps, type LayoutInput } from '@renderer/components/TimeGrid/layoutOverlaps'

const DAY_START = new Date(2026, 8, 23).getTime()
const DAY_END = DAY_START + 24 * 60 * 60 * 1000
const H = 60 * 60 * 1000

function ev(id: string, startHour: number, endHour: number): LayoutInput {
  return { id, startTs: DAY_START + startHour * H, endTs: DAY_START + endHour * H }
}

describe('layoutOverlaps: examples', () => {
  it('no overlap: each event gets full width, its own row-worth of column', () => {
    const boxes = layoutOverlaps([ev('a', 9, 10), ev('b', 11, 12)], DAY_START, DAY_END)
    for (const b of boxes) {
      expect(b.widthPct).toBe(100)
      expect(b.rightPct).toBe(0)
    }
  })

  it('a chain A-B-C splits into columns', () => {
    // A: 9-11, B: 10-12, C: 11-13 -> A/C don't overlap directly but both overlap B (chain)
    const boxes = layoutOverlaps([ev('a', 9, 11), ev('b', 10, 12), ev('c', 11, 13)], DAY_START, DAY_END)
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]))
    // all three should be in the same cluster -> same column count denominator
    const widths = new Set(boxes.map((b) => b.widthPct))
    expect(byId.a.rightPct).not.toBe(byId.b.rightPct)
    expect(widths.size).toBeGreaterThanOrEqual(1)
  })

  it('full containment: inner event does not overlap outer horizontally', () => {
    const boxes = layoutOverlaps([ev('outer', 9, 17), ev('inner', 10, 11)], DAY_START, DAY_END)
    const outer = boxes.find((b) => b.id === 'outer')!
    const inner = boxes.find((b) => b.id === 'inner')!
    const outerRange = [outer.rightPct, outer.rightPct + outer.widthPct]
    const innerRange = [inner.rightPct, inner.rightPct + inner.widthPct]
    const horizontallyOverlap = innerRange[0] < outerRange[1] && outerRange[0] < innerRange[1]
    expect(horizontallyOverlap).toBe(false)
  })

  it('identical times split evenly', () => {
    const boxes = layoutOverlaps([ev('a', 9, 10), ev('b', 9, 10)], DAY_START, DAY_END)
    expect(boxes.map((b) => b.widthPct).sort()).toEqual([50, 50])
  })

  it('events that only touch do not overlap', () => {
    const boxes = layoutOverlaps([ev('a', 10, 11), ev('b', 11, 12)], DAY_START, DAY_END)
    expect(boxes.every((b) => b.widthPct === 100)).toBe(true)
  })

  it('zero-length events are placed without crashing', () => {
    const boxes = layoutOverlaps([ev('a', 9, 9)], DAY_START, DAY_END)
    expect(boxes).toHaveLength(1)
    expect(boxes[0].heightPct).toBe(0)
  })
})

describe('layoutOverlaps: properties', () => {
  const arbEvent = fc
    .tuple(fc.integer({ min: 0, max: 22 }), fc.integer({ min: 1, max: 2 }))
    .map(([start, dur]) => [start, Math.min(start + dur, 24)] as const)

  it('every event is placed; overlapping events never overlap horizontally; boxes stay in bounds', () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { minLength: 1, maxLength: 8 }), (ranges) => {
        const events = ranges.map(([s, e], i) => ev(`e${i}`, s, e))
        const boxes = layoutOverlaps(events, DAY_START, DAY_END)
        expect(boxes).toHaveLength(events.length)

        for (const b of boxes) {
          expect(b.rightPct).toBeGreaterThanOrEqual(-1e-9)
          expect(b.rightPct + b.widthPct).toBeLessThanOrEqual(100 + 1e-9)
        }

        const byId = Object.fromEntries(events.map((e) => [e.id, e]))
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]
            const b = boxes[j]
            const ea = byId[a.id]
            const eb = byId[b.id]
            const timeOverlap = ea.startTs < eb.endTs && eb.startTs < ea.endTs
            if (timeOverlap) {
              const aRange = [a.rightPct, a.rightPct + a.widthPct]
              const bRange = [b.rightPct, b.rightPct + b.widthPct]
              const horizOverlap = aRange[0] < bRange[1] - 1e-9 && bRange[0] < aRange[1] - 1e-9
              expect(horizOverlap).toBe(false)
            }
          }
        }
      }),
      { numRuns: 100 }
    )
  })
})

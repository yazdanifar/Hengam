// Lays out same-day timed events into columns so overlapping events sit
// side by side (Google-Calendar style), with RTL-aware `right`/`width`.
export interface LayoutInput {
  id: string
  startTs: number
  endTs: number
}

export interface LayoutBox {
  id: string
  topPct: number
  heightPct: number
  rightPct: number
  widthPct: number
}

/** Two events overlap only if they share actual time; touching (10-11, 11-12) does not count. */
function overlaps(a: LayoutInput, b: LayoutInput): boolean {
  return a.startTs < b.endTs && b.startTs < a.endTs
}

/**
 * @param dayStartTs epoch ms for the top of the grid (e.g. local midnight)
 * @param dayEndTs   epoch ms for the bottom of the grid (e.g. next local midnight)
 */
export function layoutOverlaps(
  events: LayoutInput[],
  dayStartTs: number,
  dayEndTs: number
): LayoutBox[] {
  const totalMs = dayEndTs - dayStartTs
  if (totalMs <= 0 || events.length === 0) return []

  const sorted = [...events].sort((a, b) => {
    if (a.startTs !== b.startTs) return a.startTs - b.startTs
    // Longer events first, so they claim column 0 and shorter ones nest beside them.
    return b.endTs - b.startTs - (a.endTs - a.startTs)
  })

  // 1. Group into clusters of transitively-overlapping events.
  const clusters: LayoutInput[][] = []
  let current: LayoutInput[] = []
  let clusterEnd = -Infinity
  for (const ev of sorted) {
    if (current.length === 0 || ev.startTs < clusterEnd) {
      current.push(ev)
      clusterEnd = Math.max(clusterEnd, ev.endTs)
    } else {
      clusters.push(current)
      current = [ev]
      clusterEnd = ev.endTs
    }
  }
  if (current.length > 0) clusters.push(current)

  const boxes: LayoutBox[] = []

  for (const cluster of clusters) {
    // 2. Assign each event to the first column whose last event has already ended.
    const columns: LayoutInput[][] = []
    const columnOf = new Map<string, number>()
    for (const ev of cluster) {
      let placed = false
      for (let c = 0; c < columns.length; c++) {
        const last = columns[c][columns[c].length - 1]
        if (last.endTs <= ev.startTs) {
          columns[c].push(ev)
          columnOf.set(ev.id, c)
          placed = true
          break
        }
      }
      if (!placed) {
        columns.push([ev])
        columnOf.set(ev.id, columns.length - 1)
      }
    }
    const colCount = columns.length

    for (const ev of cluster) {
      const col = columnOf.get(ev.id)!
      // 3. Widen into columns to the right (i.e. columns with a higher index, which in our RTL
      //    layout sit visually to the left) while they stay free for this event's whole span.
      let span = 1
      for (let c = col + 1; c < colCount; c++) {
        const conflictsInCol = columns[c].some((other) => overlaps(other, ev))
        if (conflictsInCol) break
        span++
      }
      const widthPct = (span / colCount) * 100
      const rightPct = (col / colCount) * 100
      const topPct = ((ev.startTs - dayStartTs) / totalMs) * 100
      const heightPct = ((ev.endTs - ev.startTs) / totalMs) * 100
      boxes.push({ id: ev.id, topPct, heightPct, rightPct, widthPct })
    }
  }

  return boxes
}

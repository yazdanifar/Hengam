// Pure logic for where the day/week timeline should scroll to when it's
// opened, so the user isn't dropped at 00:00 every time. Kept separate from
// the DOM/pixel math in TimeGrid so it's easy to unit test.

export const DEFAULT_ANCHOR_HOUR = 8

export interface AnchorInput {
  /** Is "today" one of the columns currently shown (the day view's day, or any day in the week view)? */
  isTodayInView: boolean
  /** Current wall-clock time as a fractional hour (0-24), e.g. 14.5 for 14:30. Only used when isTodayInView. */
  nowHour: number
  /** Hour-of-day (0-24, fractional) of the earliest timed event in the view, if any. */
  earliestEventHour?: number
}

function clampHour(h: number): number {
  return Math.min(24, Math.max(0, h))
}

/**
 * The hour we want prominently visible: the current time if today is in
 * view, otherwise the day/week's earliest event, otherwise a sensible
 * default (the start of a normal working day).
 */
export function computeAnchorHour(input: AnchorInput): number {
  if (input.isTodayInView) return clampHour(input.nowHour)
  if (input.earliestEventHour !== undefined) return clampHour(input.earliestEventHour)
  return DEFAULT_ANCHOR_HOUR
}

/**
 * Converts an anchor hour into a scrollTop, placing it about a third of the
 * way down the viewport (with a little context above) rather than jammed
 * against the top edge. Never scrolls past the top of the grid.
 */
export function anchorScrollTop(anchorHour: number, hourHeightPx: number, viewportHeightPx: number): number {
  const target = anchorHour * hourHeightPx - viewportHeightPx / 3
  return Math.max(0, target)
}

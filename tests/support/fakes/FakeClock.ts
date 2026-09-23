import type { Clock } from '@main/ports'

interface Timer {
  id: number
  fireAt: number
  fn: () => void
}

/** A controllable clock: advance(ms) fires any due timers, in order. */
export class FakeClock implements Clock {
  private currentMs: number
  private timers: Timer[] = []
  private nextId = 1

  constructor(startIso: string) {
    this.currentMs = new Date(startIso).getTime()
  }

  now(): number {
    return this.currentMs
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++
    this.timers.push({ id, fireAt: this.currentMs + ms, fn })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle)
  }

  /** Advances the clock, firing due timers strictly in fireAt order (re-checking after each fire). */
  advance(ms: number): void {
    const target = this.currentMs + ms
    for (;;) {
      const due = this.timers.filter((t) => t.fireAt <= target).sort((a, b) => a.fireAt - b.fireAt)[0]
      if (!due) break
      this.currentMs = due.fireAt
      this.timers = this.timers.filter((t) => t.id !== due.id)
      due.fn()
    }
    this.currentMs = target
  }

  setNow(iso: string): void {
    this.currentMs = new Date(iso).getTime()
  }
}

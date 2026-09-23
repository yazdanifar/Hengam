import type { Clock } from '../ports'

export class SystemClock implements Clock {
  now(): number {
    return Date.now()
  }
  setTimeout(fn: () => void, ms: number): unknown {
    return setTimeout(fn, ms)
  }
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as NodeJS.Timeout)
  }
}

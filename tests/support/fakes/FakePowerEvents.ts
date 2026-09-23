import type { PowerEvents } from '@main/ports'

export class FakePowerEvents implements PowerEvents {
  private resumeCbs: (() => void)[] = []
  private unlockCbs: (() => void)[] = []

  onResume(cb: () => void): () => void {
    this.resumeCbs.push(cb)
    return () => (this.resumeCbs = this.resumeCbs.filter((c) => c !== cb))
  }

  onUnlockScreen(cb: () => void): () => void {
    this.unlockCbs.push(cb)
    return () => (this.unlockCbs = this.unlockCbs.filter((c) => c !== cb))
  }

  fireResume(): void {
    this.resumeCbs.forEach((cb) => cb())
  }

  fireUnlock(): void {
    this.unlockCbs.forEach((cb) => cb())
  }

  listenerCount(): number {
    return this.resumeCbs.length + this.unlockCbs.length
  }
}

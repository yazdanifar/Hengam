import type { LoopbackRedirect, LoopbackServerPort } from '@main/ports'

class FakeRedirect implements LoopbackRedirect {
  readonly redirectUri = 'http://127.0.0.1:9999/callback'
  private resolve?: (params: Record<string, string>) => void
  private reject?: (err: Error) => void
  closed = false

  constructor(private onClose: () => void) {}

  waitForCallback(signal: AbortSignal): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('oauth_aborted'))
        return
      }
      this.resolve = resolve
      this.reject = reject
      signal.addEventListener('abort', () => reject(new Error('oauth_aborted')), { once: true })
    })
  }

  deliver(params: Record<string, string>): void {
    this.resolve?.(params)
  }

  fail(err: Error): void {
    this.reject?.(err)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.onClose()
  }
}

/** Controllable loopback server fake: `deliver()`/`fail()` the one pending redirect,
 *  and `closeCount`/`pendingCount` assert the leak-discipline the real adapter must honor. */
export class FakeLoopbackServer implements LoopbackServerPort {
  closeCount = 0
  private current: FakeRedirect | null = null

  async listen(_pathname: string): Promise<LoopbackRedirect> {
    const redirect = new FakeRedirect(() => {
      this.closeCount++
      if (this.current === redirect) this.current = null
    })
    this.current = redirect
    return redirect
  }

  deliver(params: Record<string, string>): void {
    this.current?.deliver(params)
  }

  get pendingCount(): number {
    return this.current ? 1 : 0
  }
}

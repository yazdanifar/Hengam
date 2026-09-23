import type { HttpClient } from '@main/ports'

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
type Predicate = RegExp | ((url: string, init?: RequestInit) => boolean)

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** Scripted HTTP fake using the real global Response, so res.json()/.status/.headers
 *  behave exactly as in production. Matchers are tried most-recently-registered first, so
 *  a later `on()`/`onJson()` call overrides an earlier one for the same URL — handy for
 *  reprogramming a fake mid-test (e.g. connect once, then change what /token returns). */
export class FakeHttpClient implements HttpClient {
  calls: Call[] = []
  private handlers: { predicate: Predicate; handler: Handler }[] = []

  on(predicate: Predicate, handler: Handler): this {
    this.handlers.push({ predicate, handler })
    return this
  }

  onJson(predicate: Predicate, status: number, body: unknown, headers: Record<string, string> = {}): this {
    return this.on(predicate, () => new Response(JSON.stringify(body), { status, headers }))
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {}
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k] = v
    }
    this.calls.push({ url, method: init?.method ?? 'GET', headers, body: init?.body as string | undefined })

    for (let i = this.handlers.length - 1; i >= 0; i--) {
      const { predicate, handler } = this.handlers[i]
      const matches = predicate instanceof RegExp ? predicate.test(url) : predicate(url, init)
      if (matches) return handler(url, init)
    }
    throw new Error(`FakeHttpClient: no handler matched ${init?.method ?? 'GET'} ${url}`)
  }
}

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { LoopbackRedirect, LoopbackServerPort } from '../ports'

const SUCCESS_PAGE =
  '<html lang="fa" dir="rtl"><body style="font-family:system-ui;text-align:center;padding:48px">' +
  'حساب گوگل با موفقیت متصل شد. می‌توانید این صفحه را ببندید.</body></html>'
const ERROR_PAGE =
  '<html lang="fa" dir="rtl"><body style="font-family:system-ui;text-align:center;padding:48px">' +
  'اتصال لغو شد. می‌توانید این صفحه را ببندید.</body></html>'

class NodeLoopbackRedirect implements LoopbackRedirect {
  private closed = false
  private server: http.Server
  readonly redirectUri: string

  constructor(server: http.Server, port: number, private pathname: string) {
    this.server = server
    this.redirectUri = `http://127.0.0.1:${port}${pathname}`
  }

  waitForCallback(signal: AbortSignal): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('oauth_aborted'))
        return
      }

      const onAbort = (): void => {
        cleanup()
        reject(new Error('oauth_aborted'))
      }
      const cleanup = (): void => {
        signal.removeEventListener('abort', onAbort)
        this.server.removeListener('request', onRequest)
      }
      const onRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
        const url = new URL(req.url ?? '/', this.redirectUri)
        if (url.pathname !== this.pathname) {
          res.writeHead(404).end()
          return
        }
        const params = Object.fromEntries(url.searchParams)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(params.error ? ERROR_PAGE : SUCCESS_PAGE)
        cleanup()
        resolve(params)
      }

      signal.addEventListener('abort', onAbort, { once: true })
      this.server.on('request', onRequest)
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.server.closeAllConnections?.()
    this.server.close()
  }
}

/** Binds an ephemeral port on 127.0.0.1 (never 'localhost', which can resolve to ::1 and
 *  mismatch the registered redirect URI) to receive the OAuth redirect. */
export class NodeLoopbackServer implements LoopbackServerPort {
  listen(pathname: string): Promise<LoopbackRedirect> {
    return new Promise((resolve, reject) => {
      const server = http.createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        const { port } = server.address() as AddressInfo
        resolve(new NodeLoopbackRedirect(server, port, pathname))
      })
    })
  }
}

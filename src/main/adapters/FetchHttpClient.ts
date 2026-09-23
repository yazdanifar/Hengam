import { net } from 'electron'
import type { HttpClient } from '../ports'

/**
 * Uses Electron's `net.fetch` rather than Node's global `fetch`. `net` is backed by
 * Chromium's own network stack — the same one the renderer/browser uses — so it honours
 * the system's proxy configuration (System Settings, a PAC file, an env-var proxy, or a
 * VPN app that only registers itself with Chromium-based clients). Node's `fetch`
 * (undici) does none of that and talks to the network directly, which on a filtered
 * connection surfaces as a bare `TypeError: fetch failed` from a reset TLS handshake even
 * when the exact same host loads fine in the browser sitting right next to it.
 */
export class FetchHttpClient implements HttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response> {
    return net.fetch(url, init)
  }
}

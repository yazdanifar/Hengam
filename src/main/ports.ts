// Port interfaces: everything the main process needs from the outside world.
// Real implementations live in src/main/adapters/*; tests substitute fakes
// from tests/support/fakes/*. Nothing outside adapters/ should import
// 'electron', 'fetch', or call Date.now() directly — go through these.
import type Database from 'better-sqlite3'

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface HttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>
}

export interface SecretStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface BrowserLauncher {
  open(url: string): Promise<void>
}

export interface Notifier {
  show(title: string, body: string, onClick?: () => void): void
}

export interface PowerEvents {
  onResume(cb: () => void): () => void
  onUnlockScreen(cb: () => void): () => void
}

export interface DockPort {
  setIcon(pngBuffer: Buffer): void
}

export interface TrayMenuItem {
  label: string
  onClick?: () => void
  type?: 'separator' | 'checkbox'
  checked?: boolean
}

export interface TrayPort {
  setTitle(title: string): void
  setMenuItems(items: TrayMenuItem[]): void
}

/** macOS/Windows "open at login" registration. No-op on other platforms. */
export interface LoginItemPort {
  isEnabled(): boolean
  setEnabled(on: boolean): void
}

export interface HolidayFeed {
  fetchYear(jy: number): Promise<unknown>
}

/** One-shot loopback HTTP listener for the OAuth redirect (RFC 8252 §7.3). */
export interface LoopbackRedirect {
  /** e.g. http://127.0.0.1:53421/callback — exactly what goes in redirect_uri. */
  readonly redirectUri: string
  /** Resolves with the query params of the first callback request, or rejects on abort. */
  waitForCallback(signal: AbortSignal): Promise<Record<string, string>>
  /** Idempotent; closes the socket and rejects any pending waitForCallback. */
  close(): void
}

export interface LoopbackServerPort {
  /** Binds 127.0.0.1 on an ephemeral port. */
  listen(pathname: string): Promise<LoopbackRedirect>
}

/** Pushes typed events from main to the renderer. No-op until a window is attached. */
export interface RendererBridge {
  send(channel: string, payload: unknown): void
}

export interface Ports {
  db: Database.Database
  clock: Clock
  http: HttpClient
  secrets: SecretStore
  browser: BrowserLauncher
  notifier: Notifier
  power: PowerEvents
  dock: DockPort
  tray: TrayPort
  loginItem: LoginItemPort
  holidayFeed: HolidayFeed
  loopback: LoopbackServerPort
  bridge: RendererBridge
  dataDir: string
}

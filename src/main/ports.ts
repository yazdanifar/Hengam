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

export interface TrayPort {
  setTitle(title: string): void
  setMenuItems(items: { label: string; onClick?: () => void; type?: 'separator' }[]): void
}

export interface HolidayFeed {
  fetchYear(jy: number): Promise<unknown>
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
  holidayFeed: HolidayFeed
  dataDir: string
}

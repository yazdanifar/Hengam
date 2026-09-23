import path from 'node:path'
import { app } from 'electron'
import { openDatabase } from './db'
import { EventsRepo } from './repo/events'
import { TasksRepo } from './repo/tasks'
import { SyncCalendarsRepo } from './repo/syncCalendars'
import { MetaRepo } from './repo/meta'
import { HolidayService } from './services/HolidayService'
import { ReminderService } from './services/ReminderService'
import { DayTicker } from './services/DayTicker'
import { DockIconService } from './services/DockIconService'
import { TrayService } from './services/TrayService'
import { SystemClock } from './adapters/SystemClock'
import {
  ElectronBrowserLauncher,
  ElectronDock,
  ElectronNotifier,
  ElectronPowerEvents,
  ElectronTray,
  GithubHolidayFeed,
  KeychainSecretStore
} from './adapters/electronAdapters'
import { FetchHttpClient } from './adapters/FetchHttpClient'
import { NodeLoopbackServer } from './adapters/NodeLoopbackServer'
import { ElectronRendererBridge } from './adapters/ElectronRendererBridge'
import { loadGoogleConfig } from './sync/googleConfig'
import { GoogleAuth } from './sync/GoogleAuth'
import { GoogleCalendarClient } from './sync/GoogleCalendarClient'
import { SyncService } from './sync/SyncService'
import type { RendererBridge } from './ports'
import { readFileSync, appendFileSync } from 'node:fs'
import { toJalali } from '@shared/jalali'

/** The composition root: the only place real adapters are built and wired to services. */
export function buildContainer() {
  const dataDir = process.env.HENGAM_DATA_DIR || app.getPath('userData')
  installFileLogger(dataDir)
  const dbPath = path.join(dataDir, 'planner.db')
  const db = openDatabase(dbPath)

  const clock = new SystemClock()
  const events = new EventsRepo(db, clock)
  const tasks = new TasksRepo(db)
  const syncCalendars = new SyncCalendarsRepo(db)
  const meta = new MetaRepo(db)

  const bundledHolidaysDir = path.join(__dirname, '../../src/shared/data/holidays')
  const holidays = new HolidayService(clock, new GithubHolidayFeed(), dataDir, bundledHolidaysDir)

  const notifier = new ElectronNotifier()
  const reminders = new ReminderService(db, clock, notifier, events)

  const dock = new ElectronDock()
  const iconTemplatePath = path.join(__dirname, '../../build/icon-day.svg')
  const dockIcon = new DockIconService(dock, iconTemplatePath)

  const iconPng = readFileSync(path.join(__dirname, '../../build/icon.png'))
  const trayPort = new ElectronTray(iconPng)

  const secrets = new KeychainSecretStore(path.join(dataDir, 'google.bin'))
  const browser = new ElectronBrowserLauncher()
  const http = new FetchHttpClient()
  const loopback = new NodeLoopbackServer()
  const bridge = new ElectronRendererBridge()

  const googleConfig = loadGoogleConfig()
  const auth = new GoogleAuth(
    googleConfig ?? placeholderGoogleConfig(),
    http,
    secrets,
    browser,
    loopback,
    clock
  )
  const calendarClient = new GoogleCalendarClient(googleConfig ?? placeholderGoogleConfig(), http, auth, clock)

  let lastDay: ReturnType<typeof toJalali> | undefined
  let lastDayDate: Date | undefined

  // Wraps the real renderer bridge so a sync-status push also refreshes the tray's
  // "همگام‌سازی" item and connected-account state, without teaching SyncService about
  // the tray or the container about SyncService's internals.
  const trayAwareBridge: RendererBridge = {
    send: (channel, payload) => {
      bridge.send(channel, payload)
      if (channel === 'sync:status') refreshTray()
    }
  }

  const sync = new SyncService(
    clock,
    new ElectronPowerEvents(),
    auth,
    calendarClient,
    events,
    syncCalendars,
    meta,
    trayAwareBridge,
    googleConfig !== null
  )

  const tray = new TrayService(trayPort, holidays, {
    onShowWindow: () => {},
    onNewEvent: () => {},
    onQuit: () => app.quit(),
    onOpenEvent: () => {},
    onSyncNow: () => void sync.syncNow('manual')
  })

  function refreshTray(): void {
    if (!lastDay || !lastDayDate) return
    const dayStart = new Date(lastDayDate).setHours(0, 0, 0, 0)
    const dayEnd = dayStart + 24 * 60 * 60 * 1000
    const todaysEvents = events.rangeQuery(dayStart, dayEnd)
    tray.update(lastDay, lastDayDate, todaysEvents, sync.getStatus().connected)
  }

  const power = new ElectronPowerEvents()
  const dayTicker = new DayTicker(clock, power, (day) => {
    dockIcon.update(day)
    lastDay = day
    lastDayDate = new Date(clock.now())
    refreshTray()
  })

  return {
    db,
    clock,
    events,
    tasks,
    holidays,
    reminders,
    dockIcon,
    tray,
    dayTicker,
    secrets,
    browser,
    http,
    loopback,
    bridge,
    syncCalendars,
    meta,
    auth,
    calendarClient,
    sync,
    dataDir
  }
}

// GoogleAuth/GoogleCalendarClient are always constructed (so the container shape is
// stable and testable), even when no client id/secret is configured; SyncService checks
// `configured` before ever using them, so a placeholder here is never dereferenced.
function placeholderGoogleConfig() {
  return {
    clientId: '',
    clientSecret: '',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
    apiBase: 'https://www.googleapis.com/calendar/v3',
    scopes: []
  }
}

export type Container = ReturnType<typeof buildContainer>

/** Mirrors console.error/console.warn to <dataDir>/debug.log — a packaged, unsigned app run
 *  via Finder/`open` has no attached terminal, so this is the only way to see what went wrong. */
function installFileLogger(dataDir: string): void {
  const logPath = path.join(dataDir, 'debug.log')
  const write = (level: string, args: unknown[]): void => {
    const line = args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(' ')
    try {
      appendFileSync(logPath, `[${new Date().toISOString()}] ${level} ${line}\n`)
    } catch {
      // best effort — logging must never crash the app
    }
  }
  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    originalError(...args)
    write('ERROR', args)
  }
  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    write('WARN', args)
  }
}

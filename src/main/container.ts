import path from 'node:path'
import { app } from 'electron'
import { openDatabase } from './db'
import { EventsRepo } from './repo/events'
import { SyncCalendarsRepo } from './repo/syncCalendars'
import { MetaRepo } from './repo/meta'
import { HolidayService } from './services/HolidayService'
import { NotificationCenter } from './services/NotificationCenter'
import { AlertMonitor } from './services/AlertMonitor'
import { NotificationsRepo } from './repo/notifications'
import { AlertSettingsRepo } from './repo/alertSettings'
import { ReminderService } from './services/ReminderService'
import { DayTicker } from './services/DayTicker'
import { DockIconService } from './services/DockIconService'
import { TrayService } from './services/TrayService'
import { SystemClock } from './adapters/SystemClock'
import {
  ElectronBrowserLauncher,
  ElectronDock,
  ElectronLoginItem,
  ElectronNotifier,
  ElectronPowerEvents,
  ElectronTray,
  TimeIrHolidayFeed,
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
import type { SettingsSection } from '@shared/events'
import { appendFileSync } from 'node:fs'
import { toJalali } from '@shared/jalali'

/** The composition root: the only place real adapters are built and wired to services. */
export function buildContainer({
  showWindow,
  setWindowIcon
}: {
  showWindow: () => void
  setWindowIcon: (png: Buffer) => void
}) {
  const dataDir = process.env.HENGAM_DATA_DIR || app.getPath('userData')
  installFileLogger(dataDir)
  const dbPath = path.join(dataDir, 'planner.db')
  const db = openDatabase(dbPath)

  const clock = new SystemClock()
  const events = new EventsRepo(db, clock)
  const syncCalendars = new SyncCalendarsRepo(db)
  const meta = new MetaRepo(db)

  const power = new ElectronPowerEvents()
  const bridge = new ElectronRendererBridge()
  const notifier = new ElectronNotifier()

  // Every service pushes through this: it forwards to the renderer, and lets the status
  // pushes that matter elsewhere also refresh the tray and re-check failure alerts —
  // without teaching SyncService or HolidayService about the tray or the bell.
  const observedBridge: RendererBridge = {
    send: (channel, payload) => {
      bridge.send(channel, payload)
      if (channel === 'sync:status') {
        refreshTray()
        alerts.evaluate()
      } else if (channel === 'holidays:status') {
        alerts.evaluate()
      } else if (channel === 'holidays:changed') {
        refreshTray()
      }
    }
  }

  const bundledHolidaysDir = path.join(__dirname, '../../src/shared/data/holidays')
  const holidays = new HolidayService(
    clock,
    new TimeIrHolidayFeed(),
    dataDir,
    bundledHolidaysDir,
    meta,
    power,
    observedBridge
  )

  const notifications = new NotificationCenter(new NotificationsRepo(db), clock, observedBridge)
  const alertSettings = new AlertSettingsRepo(meta)

  const reminders = new ReminderService(db, clock, notifier, events, undefined, (r) => notifications.addReminder(r))

  const macDock = new ElectronDock()
  const trayPort = new ElectronTray(showWindow)
  // The detailed day icon goes to the macOS Dock; the simplified one to the Windows tray and window/taskbar.
  const dock = {
    setIcon(png: Buffer): void {
      macDock.setIcon(png)
    },
    setSmallIcon(png: Buffer): void {
      trayPort.setIcon(png)
      setWindowIcon(png)
    }
  }
  const iconTemplatePath = path.join(__dirname, '../../build/icon-day.svg')
  const smallIconTemplatePath = path.join(__dirname, '../../build/icon-tray.svg')
  // resvg's native code can't read inside app.asar, so the font is asar-unpacked (see package.json).
  const dockIconFont = path
    .join(__dirname, '../../node_modules/vazirmatn/fonts/ttf/Vazirmatn-ExtraBold.ttf')
    .replace('app.asar', 'app.asar.unpacked')
  const dockIcon = new DockIconService(dock, iconTemplatePath, dockIconFont, smallIconTemplatePath)

  const loginItem = new ElectronLoginItem()
  // Default "open at login" on so the Dock icon shows today's date without the user
  // having to find the toggle. Applied once ever (tracked in meta), so a user who
  // later turns it off keeps that choice across restarts. Packaged builds only: an
  // unpackaged (dev/test) run would register the bare Electron binary as a login item.
  if (app.isPackaged && meta.get('loginItemDefaultApplied') === undefined) {
    loginItem.setEnabled(true)
    meta.set('loginItemDefaultApplied', '1')
  }

  const secrets = new KeychainSecretStore(path.join(dataDir, 'google.bin'))
  const browser = new ElectronBrowserLauncher()
  const http = new FetchHttpClient()
  const loopback = new NodeLoopbackServer()

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

  const sync = new SyncService(
    clock,
    power,
    auth,
    calendarClient,
    events,
    syncCalendars,
    meta,
    observedBridge,
    googleConfig !== null
  )

  // An alert's OS notification opens the window on the settings tab for that job.
  function openSettings(section: SettingsSection): void {
    showWindow()
    bridge.send('settings:open', { section })
  }

  const alerts = new AlertMonitor(
    clock,
    notifications,
    alertSettings,
    {
      sync_failure: () => sync.getStatus().failingSince,
      holiday_failure: () => holidays.getStatus().failingSince
    },
    notifier,
    openSettings
  )

  const tray = new TrayService(trayPort, holidays, {
    onShowWindow: showWindow,
    onNewEvent: () => {},
    onQuit: () => app.quit(),
    onOpenEvent: () => {},
    onSyncNow: () => void sync.syncNow('manual'),
    isOpenAtLogin: () => loginItem.isEnabled(),
    onToggleOpenAtLogin: () => {
      loginItem.setEnabled(!loginItem.isEnabled())
      refreshTray()
    }
  })

  function refreshTray(): void {
    if (!lastDay || !lastDayDate) return
    const dayStart = new Date(lastDayDate).setHours(0, 0, 0, 0)
    const dayEnd = dayStart + 24 * 60 * 60 * 1000
    const todaysEvents = events.rangeQuery(dayStart, dayEnd)
    tray.update(lastDay, lastDayDate, todaysEvents, sync.getStatus().connected)
  }

  const dayTicker = new DayTicker(clock, power, (day) => {
    // DayTicker.start() calls this synchronously during startup; a rendering failure
    // (missing font/template, resvg error) must not take down the tray, sync or window.
    try {
      dockIcon.update(day)
    } catch (err) {
      console.error('Dock icon update failed', err)
    }
    lastDay = day
    lastDayDate = new Date(clock.now())
    refreshTray()
  })

  return {
    db,
    clock,
    events,
    holidays,
    notifications,
    alertSettings,
    alerts,
    reminders,
    dockIcon,
    tray,
    loginItem,
    dayTicker,
    refreshTray,
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

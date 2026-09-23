import path from 'node:path'
import { app } from 'electron'
import { openDatabase } from './db'
import { EventsRepo } from './repo/events'
import { TasksRepo } from './repo/tasks'
import { CategoriesRepo } from './repo/categories'
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
import { readFileSync } from 'node:fs'

/** The composition root: the only place real adapters are built and wired to services. */
export function buildContainer() {
  const dataDir = process.env.HENGAM_DATA_DIR || app.getPath('userData')
  const dbPath = path.join(dataDir, 'planner.db')
  const db = openDatabase(dbPath)

  const clock = new SystemClock()
  const events = new EventsRepo(db, clock)
  const tasks = new TasksRepo(db)
  const categories = new CategoriesRepo(db)

  const bundledHolidaysDir = path.join(__dirname, '../../src/shared/data/holidays')
  const holidays = new HolidayService(clock, new GithubHolidayFeed(), dataDir, bundledHolidaysDir)

  const notifier = new ElectronNotifier()
  const reminders = new ReminderService(db, clock, notifier, events)

  const dock = new ElectronDock()
  const iconTemplatePath = path.join(__dirname, '../../build/icon-day.svg')
  const dockIcon = new DockIconService(dock, iconTemplatePath)

  const iconPng = readFileSync(path.join(__dirname, '../../build/icon.png'))
  const trayPort = new ElectronTray(iconPng)
  const tray = new TrayService(trayPort, holidays, {
    onShowWindow: () => {},
    onNewEvent: () => {},
    onQuit: () => app.quit(),
    onOpenEvent: () => {}
  })

  const power = new ElectronPowerEvents()
  const dayTicker = new DayTicker(clock, power, (day) => {
    dockIcon.update(day)
  })

  const secrets = new KeychainSecretStore(path.join(dataDir, 'google.bin'))
  const browser = new ElectronBrowserLauncher()

  return {
    db,
    clock,
    events,
    tasks,
    categories,
    holidays,
    reminders,
    dockIcon,
    tray,
    dayTicker,
    secrets,
    browser,
    dataDir
  }
}

export type Container = ReturnType<typeof buildContainer>

import { app, Notification, powerMonitor, shell, Tray, Menu, nativeImage, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { TimeIrClient } from '@shared/timeIrHolidays'
import type {
  BrowserLauncher,
  DockPort,
  HolidayFeed,
  LoginItemPort,
  Notifier,
  PowerEvents,
  SecretStore,
  TrayMenuItem,
  TrayPort
} from '../ports'

export class ElectronNotifier implements Notifier {
  show(title: string, body: string, onClick?: () => void): void {
    const n = new Notification({ title, body })
    if (onClick) n.on('click', onClick)
    n.show()
  }
}

export class ElectronPowerEvents implements PowerEvents {
  onResume(cb: () => void): () => void {
    powerMonitor.on('resume', cb)
    return () => powerMonitor.off('resume', cb)
  }
  onUnlockScreen(cb: () => void): () => void {
    powerMonitor.on('unlock-screen', cb)
    return () => powerMonitor.off('unlock-screen', cb)
  }
}

export class ElectronBrowserLauncher implements BrowserLauncher {
  async open(url: string): Promise<void> {
    await shell.openExternal(url)
  }
}

/** macOS Dock icon. Other platforms are handled by the tray and window icon sinks. */
export class ElectronDock implements DockPort {
  setIcon(pngBuffer: Buffer): void {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(nativeImage.createFromBuffer(pngBuffer))
    }
  }
}

export class ElectronTray implements TrayPort {
  private tray: Tray | undefined

  constructor(onActivate?: () => void) {
    // macOS: no icon, the menu bar shows just the date title. Windows has no tray text,
    // so the icon is replaced with the day icon via setIcon() and the date goes in the tooltip.
    this.tray = new Tray(nativeImage.createEmpty())
    if (process.platform === 'win32' && onActivate) this.tray.on('click', onActivate)
  }

  setTitle(title: string, tooltip?: string): void {
    this.tray?.setTitle(title) // macOS only
    this.tray?.setToolTip(tooltip ?? title)
  }

  setIcon(pngBuffer: Buffer): void {
    if (process.platform !== 'win32') return
    this.tray?.setImage(nativeImage.createFromBuffer(pngBuffer).resize({ width: 32, height: 32 }))
  }

  setMenuItems(items: TrayMenuItem[]): void {
    this.tray?.setContextMenu(
      Menu.buildFromTemplate(
        items.map((i) =>
          i.type === 'separator'
            ? { type: 'separator' }
            : i.type === 'checkbox'
              ? { type: 'checkbox', label: i.label, checked: i.checked, click: i.onClick }
              : { label: i.label, click: i.onClick }
        )
      )
    )
  }
}

/** Argument Windows passes at login so the app starts hidden in the tray. */
export const HIDDEN_LAUNCH_ARG = '--hidden'

/** Registers/unregisters Hengam as a macOS/Windows login item. No-op on other platforms. */
export class ElectronLoginItem implements LoginItemPort {
  isEnabled(): boolean {
    if (process.platform === 'darwin') return app.getLoginItemSettings().openAtLogin
    if (process.platform === 'win32') {
      return app.getLoginItemSettings({ args: [HIDDEN_LAUNCH_ARG] }).openAtLogin
    }
    return false
  }

  setEnabled(on: boolean): void {
    if (process.platform === 'darwin') app.setLoginItemSettings({ openAtLogin: on })
    else if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_LAUNCH_ARG] })
    }
  }
}

/** Encrypts secrets with the OS keychain/DPAPI (via safeStorage) before writing them to disk. */
export class KeychainSecretStore implements SecretStore {
  constructor(private filePath: string) {}

  async get(key: string): Promise<string | undefined> {
    try {
      const all = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Record<string, string>
      const encoded = all[key]
      if (!encoded) return undefined
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      return undefined
    }
  }

  async set(key: string, value: string): Promise<void> {
    let all: Record<string, string> = {}
    try {
      all = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
    } catch {
      // no file yet
    }
    all[key] = safeStorage.encryptString(value).toString('base64')
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(all))
  }

  async delete(key: string): Promise<void> {
    try {
      const all = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Record<string, string>
      delete all[key]
      fs.writeFileSync(this.filePath, JSON.stringify(all))
    } catch {
      // nothing to delete
    }
  }
}

/** Fetches holidays directly from time.ir; see @shared/timeIrHolidays for how. */
export class TimeIrHolidayFeed implements HolidayFeed {
  private client = new TimeIrClient()

  async fetchYear(jy: number): Promise<unknown> {
    return this.client.fetchYear(jy)
  }
}

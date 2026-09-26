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

export class ElectronDock implements DockPort {
  setIcon(pngBuffer: Buffer): void {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(nativeImage.createFromBuffer(pngBuffer))
    }
  }
}

export class ElectronTray implements TrayPort {
  private tray: Tray | undefined

  constructor() {
    // No icon: the menu bar shows just the date title.
    this.tray = new Tray(nativeImage.createEmpty())
  }

  setTitle(title: string): void {
    this.tray?.setTitle(title)
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

/** Registers/unregisters Hengam as a macOS login item. No-op on other platforms. */
export class ElectronLoginItem implements LoginItemPort {
  isEnabled(): boolean {
    if (process.platform !== 'darwin') return false
    return app.getLoginItemSettings().openAtLogin
  }

  setEnabled(on: boolean): void {
    if (process.platform !== 'darwin') return
    app.setLoginItemSettings({ openAtLogin: on })
  }
}

/** Encrypts secrets with the OS Keychain (via safeStorage) before writing them to disk. */
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

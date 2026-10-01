import { app, BrowserWindow, Menu, nativeImage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { buildContainer, type Container } from './container'
import { registerIpc } from './ipc'
import { HIDDEN_LAUNCH_ARG } from './adapters/electronAdapters'
import { buildIco } from '../../scripts/ico.mjs'

let mainWindow: BrowserWindow | null = null
let container: Container | null = null

// Closing the window hides it so reminders/sync keep running in the tray;
// set true only once the app is actually quitting (before-quit), so the
// window is allowed to close for real and the quit sequence isn't aborted.
const keepInTray = true
let isQuitting = false
// Latest day icon (Windows taskbar/window); reapplied if the window is recreated.
let windowIcon: Electron.NativeImage | undefined

function createWindow(show: boolean = true): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'هنگام',
    show,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', (e) => {
    if (keepInTray && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    container?.bridge.detach()
  })
}

function setWindowIcon(png: Buffer): void {
  if (process.platform !== 'win32') return
  windowIcon = nativeImage.createFromBuffer(png).resize({ width: 256, height: 256 })
  mainWindow?.setIcon(windowIcon)
  updateShortcutIcon(windowIcon)
}

// The taskbar button takes its icon from the Start-menu shortcut that shares the app's
// AppUserModelID, not from the window, so the shortcut's icon is rewritten each day.
function updateShortcutIcon(img: Electron.NativeImage): void {
  if (!app.isPackaged) return
  try {
    const shortcut = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hengam.lnk')
    if (!fs.existsSync(shortcut)) return
    const sizes = [16, 32, 48, 256]
    const ico = buildIco(
      sizes.map((size) => ({ size, data: img.resize({ width: size, height: size }).toPNG() }))
    )
    const icoPath = path.join(app.getPath('userData'), 'day.ico')
    fs.writeFileSync(icoPath, ico)
    shell.writeShortcutLink(shortcut, 'update', {
      ...shell.readShortcutLink(shortcut),
      icon: icoPath,
      iconIndex: 0
    })
  } catch (err) {
    console.error('Shortcut icon update failed', err)
  }
}

// Shows the window, creating it if it no longer exists (a login-item launch creates it
// hidden, so usually this just reveals it). Passed into the container so the
// tray's "نمایش هنگام" item and the Dock's activate event share this one path.
function showWindow(): void {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(true)
  else mainWindow?.show()
  if (mainWindow) container?.bridge.attach(mainWindow)
}

app.setAppUserModelId('ir.hengam.app') // Windows toast notifications need a stable id

// A second copy would open the same database and double every reminder and sync.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  // Packaged Windows build: no File/Edit/View bar on the window.
  if (process.platform === 'win32' && app.isPackaged) Menu.setApplicationMenu(null)
  container = buildContainer({ showWindow, setWindowIcon })
  registerIpc(container)
  container.reminders.start()
  container.dayTicker.start()
  container.sync.start()
  container.holidays.start()
  container.alerts.start()
  // Login items launch in the background: the Dock icon and tray still work, but no
  // window pops up unasked-for (App Store guideline 2.4.5(iii) requires this). On Windows
  // the login item is registered with HIDDEN_LAUNCH_ARG instead.
  const openedAtLogin =
    (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin) ||
    (process.platform === 'win32' && process.argv.includes(HIDDEN_LAUNCH_ARG))
  createWindow(!openedAtLogin)
  // Attach even when hidden: its renderer is live, and must keep receiving sync-status
  // and data-changed pushes so it isn't stale when the user first opens it.
  if (mainWindow) container.bridge.attach(mainWindow)

  app.on('activate', () => showWindow())
})

// Fired before any window starts closing, for every quit path: Cmd+Q, the Dock's
// "Quit" item, the tray "Quit" item (the only quit path on Windows) calling app.quit(), or app.quit() from
// anywhere else. Without this flag the window's close handler above would keep
// preventing the close, and Electron aborts the whole quit sequence when a
// window's close is prevented — Cmd+Q would silently do nothing.
app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || !keepInTray) app.quit()
})

// Release every resource the running services hold — timers, power-event
// subscriptions, the SQLite connection — so the process can exit cleanly
// rather than relying on the OS to tear it down.
app.on('will-quit', () => {
  container?.reminders.stop()
  container?.dayTicker.stop()
  container?.holidays.stop()
  container?.alerts.stop()
  // Stop sync (which aborts any in-flight request) before closing the database — an
  // in-flight write landing after db.close() would throw.
  container?.sync.stop()
  try {
    container?.db.close()
  } catch {
    // already closed
  }
})

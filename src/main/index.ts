import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { buildContainer, type Container } from './container'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
let container: Container | null = null

// Closing the window hides it so reminders/sync keep running in the tray;
// set true only once the app is actually quitting (before-quit), so the
// window is allowed to close for real and the quit sequence isn't aborted.
const keepInTray = true
let isQuitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'هنگام',
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

app.whenReady().then(() => {
  container = buildContainer()
  registerIpc(container)
  container.reminders.start()
  container.dayTicker.start()
  container.sync.start()
  createWindow()
  if (mainWindow) container.bridge.attach(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
    if (mainWindow) container?.bridge.attach(mainWindow)
  })
})

// Fired before any window starts closing, for every quit path: Cmd+Q, the Dock's
// "Quit" item, a tray "Quit" menu item calling app.quit(), or app.quit() from
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
  // Stop sync (which aborts any in-flight request) before closing the database — an
  // in-flight write landing after db.close() would throw.
  container?.sync.stop()
  try {
    container?.db.close()
  } catch {
    // already closed
  }
})

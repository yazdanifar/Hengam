import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { buildContainer } from './container'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

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
    if (keepInTray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

let keepInTray = true

app.whenReady().then(() => {
  const container = buildContainer()
  registerIpc(container)
  container.reminders.start()
  container.dayTicker.start()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || !keepInTray) app.quit()
})

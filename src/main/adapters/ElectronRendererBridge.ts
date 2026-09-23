import type { BrowserWindow } from 'electron'
import type { RendererBridge } from '../ports'

/** Sends events to the main window's renderer. Safe to call before a window is attached,
 *  or after it has been closed/destroyed — it just becomes a no-op. */
export class ElectronRendererBridge implements RendererBridge {
  private win: BrowserWindow | null = null

  attach(win: BrowserWindow): void {
    this.win = win
  }

  detach(): void {
    this.win = null
  }

  send(channel: string, payload: unknown): void {
    if (!this.win || this.win.isDestroyed() || this.win.webContents.isDestroyed()) return
    this.win.webContents.send(channel, payload)
  }
}

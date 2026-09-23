import type { BrowserLauncher } from '@main/ports'

export class FakeBrowserLauncher implements BrowserLauncher {
  opened: string[] = []

  async open(url: string): Promise<void> {
    this.opened.push(url)
  }
}

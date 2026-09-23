import type { Notifier } from '@main/ports'

export interface ShownNotification {
  title: string
  body: string
  onClick?: () => void
}

export class SpyNotifier implements Notifier {
  shown: ShownNotification[] = []

  show(title: string, body: string, onClick?: () => void): void {
    this.shown.push({ title, body, onClick })
  }
}

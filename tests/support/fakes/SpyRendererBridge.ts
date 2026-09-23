import type { RendererBridge } from '@main/ports'

export class SpyRendererBridge implements RendererBridge {
  sent: { channel: string; payload: unknown }[] = []

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
}

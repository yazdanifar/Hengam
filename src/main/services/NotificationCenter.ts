import type { AlertKind, AppNotification } from '@shared/notifications'
import type { Clock, RendererBridge } from '../ports'
import type { NotificationsRepo } from '../repo/notifications'

/** The inbox behind the header bell: every mutation is persisted, then pushed to the renderer. */
export class NotificationCenter {
  constructor(
    private repo: NotificationsRepo,
    private clock: Clock,
    private bridge: RendererBridge
  ) {}

  list(): AppNotification[] {
    return this.repo.list()
  }

  activeAlert(kind: AlertKind): AppNotification | undefined {
    return this.repo.activeAlert(kind)
  }

  addReminder(input: { title: string; body: string; eventStartTs: number }): AppNotification {
    const n = this.repo.addReminder({ ...input, createdAt: this.clock.now() })
    this.repo.prune(this.clock.now())
    this.changed()
    return n
  }

  /** Opens an alert for a failure episode; a no-op returning undefined if one is already active. */
  raiseAlert(kind: AlertKind, failingSince: number): AppNotification | undefined {
    if (this.repo.activeAlert(kind)) return undefined
    const n = this.repo.addAlert(kind, failingSince, this.clock.now())
    this.changed()
    return n
  }

  resolveAlert(kind: AlertKind): void {
    if (this.repo.resolveAlert(kind, this.clock.now())) this.changed()
  }

  markAllRead(): void {
    if (this.repo.markAllRead(this.clock.now())) this.changed()
  }

  dismiss(id: number): void {
    if (this.repo.dismiss(id)) this.changed()
  }

  clearAll(): void {
    if (this.repo.clearAll()) this.changed()
  }

  private changed(): void {
    this.bridge.send('notifications:changed', { changedAt: this.clock.now() })
  }
}

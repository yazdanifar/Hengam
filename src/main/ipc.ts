import { ipcMain } from 'electron'
import { monthLength } from '@shared/jalali'
import { getDayInfo } from '@shared/holidays'
import type { Container } from './container'
import type { CreateEventInput, UpdateEventInput } from '@shared/api'
import type { AlertSettings } from '@shared/notifications'

export function registerIpc(c: Container): void {
  ipcMain.handle('events:range', (_e, startTs: number, endTs: number) => c.events.rangeQuery(startTs, endTs))

  ipcMain.handle('events:get', (_e, id: string) => c.events.getById(id))

  // Every local mutation refreshes the tray (whose menu lists today's events) and kicks
  // off a sync in the background. Fire-and-forget: syncNow() never throws (runOnce
  // catches everything into an error status) and the handler doesn't await it, so an
  // event save returns to the renderer immediately regardless of how long the sync takes.
  function afterLocalChange(): void {
    c.refreshTray()
    void c.sync.syncNow('local-change')
  }

  ipcMain.handle('events:create', (_e, input: CreateEventInput) => {
    const created = c.events.create(input)
    afterLocalChange()
    return created
  })

  ipcMain.handle('events:update', (_e, input: UpdateEventInput) => {
    if (input.scope === 'this' && input.occurrenceStartTs !== undefined) {
      c.events.addException({
        eventId: input.id,
        occurrenceStartTs: input.occurrenceStartTs,
        kind: 'override',
        override: {
          title: input.title,
          notes: input.notes,
          color: input.color,
          startTs: input.startTs,
          endTs: input.endTs
        }
      })
    } else {
      c.events.update(input.id, input)
    }
    afterLocalChange()
  })

  ipcMain.handle('events:remove', (_e, id: string, scope?: 'this' | 'all', occurrenceStartTs?: number) => {
    if (scope === 'this' && occurrenceStartTs !== undefined) {
      c.events.addException({ eventId: id, occurrenceStartTs, kind: 'skip' })
    } else {
      c.events.softDelete(id)
    }
    afterLocalChange()
  })

  ipcMain.handle('events:listExceptions', (_e, eventId: string) => c.events.listExceptions(eventId))

  // Refreshing is HolidayService's own daily schedule; reading never waits on the network.
  ipcMain.handle('holidays:year', (_e, jy: number) => {
    const out: { jm: number; jd: number; info: ReturnType<typeof getDayInfo> }[] = []
    for (let jm = 1; jm <= 12; jm++) {
      for (let jd = 1; jd <= monthLength(jy, jm); jd++) {
        out.push({ jm, jd, info: getDayInfo({ jy, jm, jd }, c.holidays) })
      }
    }
    return out
  })
  ipcMain.handle('holidays:status', () => c.holidays.getStatus())
  ipcMain.handle('holidays:refreshNow', () => c.holidays.refreshNow())

  ipcMain.handle('notifications:list', () => c.notifications.list())
  ipcMain.handle('notifications:markAllRead', () => c.notifications.markAllRead())
  ipcMain.handle('notifications:dismiss', (_e, id: number) => c.notifications.dismiss(id))
  ipcMain.handle('notifications:clearAll', () => c.notifications.clearAll())

  ipcMain.handle('settings:getAlerts', () => c.alertSettings.get())
  // A changed threshold can put an ongoing failure over (or back under) the line right away.
  ipcMain.handle('settings:setAlerts', (_e, patch: Partial<AlertSettings>) => {
    const next = c.alertSettings.set(patch)
    c.alerts.evaluate()
    return next
  })

  const toDto = (cal: { calendarId: string; summary: string; color?: string; enabled: boolean; isDefaultTarget: boolean }) => ({
    calendarId: cal.calendarId,
    summary: cal.summary,
    color: cal.color,
    enabled: cal.enabled,
    isDefaultTarget: cal.isDefaultTarget
  })

  // Every google:* handler resolves with a SyncStatus carrying errorCode rather than
  // rejecting — a rejected ipcMain.handle serializes to an opaque string in the renderer,
  // useless for Persian UI copy.
  ipcMain.handle('google:status', () => c.sync.getStatus())
  ipcMain.handle('google:connect', () => c.sync.connect())
  ipcMain.handle('google:cancelConnect', () => c.sync.cancelConnect())
  ipcMain.handle('google:disconnect', () => c.sync.disconnect())
  ipcMain.handle('google:syncNow', () => c.sync.syncNow('manual'))
  ipcMain.handle('google:listCalendars', () => c.syncCalendars.list().map(toDto))
  ipcMain.handle('google:refreshCalendars', async () => (await c.sync.refreshCalendars()).map(toDto))
  ipcMain.handle('google:setCalendarEnabled', (_e, id: string, enabled: boolean) => c.sync.setCalendarEnabled(id, enabled))
  ipcMain.handle('google:setDefaultTarget', (_e, id: string) => c.sync.setDefaultTarget(id))
}

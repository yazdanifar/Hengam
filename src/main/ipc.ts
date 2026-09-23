import { ipcMain } from 'electron'
import { monthLength, toJalali } from '@shared/jalali'
import { getDayInfo } from '@shared/holidays'
import type { Container } from './container'
import type { CreateEventInput, UpdateEventInput } from '@shared/api'

export function registerIpc(c: Container): void {
  ipcMain.handle('events:range', (_e, startTs: number, endTs: number) => c.events.rangeQuery(startTs, endTs))

  ipcMain.handle('events:create', (_e, input: CreateEventInput) => c.events.create(input))

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
  })

  ipcMain.handle('events:remove', (_e, id: string, scope?: 'this' | 'all', occurrenceStartTs?: number) => {
    if (scope === 'this' && occurrenceStartTs !== undefined) {
      c.events.addException({ eventId: id, occurrenceStartTs, kind: 'skip' })
    } else {
      c.events.softDelete(id)
    }
  })

  ipcMain.handle('events:listExceptions', (_e, eventId: string) => c.events.listExceptions(eventId))

  ipcMain.handle('tasks:listForDate', (_e, jdate: string) => c.tasks.listForDate(jdate))
  ipcMain.handle('tasks:create', (_e, jdate: string, title: string) => c.tasks.create(jdate, title))
  ipcMain.handle('tasks:toggle', (_e, id: string, done: boolean) => c.tasks.toggle(id, done))
  ipcMain.handle('tasks:remove', (_e, id: string) => c.tasks.remove(id))
  ipcMain.handle('tasks:reorder', (_e, jdate: string, orderedIds: string[]) => c.tasks.reorder(jdate, orderedIds))

  ipcMain.handle('holidays:year', async (_e, jy: number) => {
    await c.holidays.refreshIfDue(toJalali(new Date(c.clock.now())).jy)
    const out: { jm: number; jd: number; info: ReturnType<typeof getDayInfo> }[] = []
    for (let jm = 1; jm <= 12; jm++) {
      for (let jd = 1; jd <= monthLength(jy, jm); jd++) {
        out.push({ jm, jd, info: getDayInfo({ jy, jm, jd }, c.holidays) })
      }
    }
    return out
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

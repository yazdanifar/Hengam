import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { HengamApi } from '@shared/api'
import type { MainToRendererEvents } from '@shared/events'

/** Wraps ipcRenderer.on so the renderer callback never sees the raw IpcRendererEvent
 *  (which carries `sender` across the context bridge), and returns a matching unsubscribe. */
function subscribe<K extends keyof MainToRendererEvents>(
  channel: K,
  cb: (payload: MainToRendererEvents[K]) => void
): () => void {
  const listener = (_e: IpcRendererEvent, payload: MainToRendererEvents[K]): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: HengamApi = {
  events: {
    range: (startTs, endTs) => ipcRenderer.invoke('events:range', startTs, endTs),
    create: (input) => ipcRenderer.invoke('events:create', input),
    update: (input) => ipcRenderer.invoke('events:update', input),
    remove: (id, scope, occurrenceStartTs) => ipcRenderer.invoke('events:remove', id, scope, occurrenceStartTs),
    listExceptions: (eventId) => ipcRenderer.invoke('events:listExceptions', eventId)
  },
  tasks: {
    listForDate: (jdate) => ipcRenderer.invoke('tasks:listForDate', jdate),
    create: (jdate, title) => ipcRenderer.invoke('tasks:create', jdate, title),
    toggle: (id, done) => ipcRenderer.invoke('tasks:toggle', id, done),
    remove: (id) => ipcRenderer.invoke('tasks:remove', id),
    reorder: (jdate, orderedIds) => ipcRenderer.invoke('tasks:reorder', jdate, orderedIds)
  },
  holidays: {
    year: (jy) => ipcRenderer.invoke('holidays:year', jy)
  },
  google: {
    status: () => ipcRenderer.invoke('google:status'),
    connect: () => ipcRenderer.invoke('google:connect'),
    cancelConnect: () => ipcRenderer.invoke('google:cancelConnect'),
    disconnect: () => ipcRenderer.invoke('google:disconnect'),
    syncNow: () => ipcRenderer.invoke('google:syncNow'),
    listCalendars: () => ipcRenderer.invoke('google:listCalendars'),
    refreshCalendars: () => ipcRenderer.invoke('google:refreshCalendars'),
    setCalendarEnabled: (calendarId, enabled) => ipcRenderer.invoke('google:setCalendarEnabled', calendarId, enabled),
    setDefaultTarget: (calendarId) => ipcRenderer.invoke('google:setDefaultTarget', calendarId),
    onStatus: (cb) => subscribe('sync:status', cb),
    onEventsChanged: (cb) => subscribe('events:changed', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)

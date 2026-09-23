import { contextBridge, ipcRenderer } from 'electron'
import type { HengamApi } from '@shared/api'

const api: HengamApi = {
  events: {
    range: (startTs, endTs) => ipcRenderer.invoke('events:range', startTs, endTs),
    create: (input) => ipcRenderer.invoke('events:create', input),
    update: (input) => ipcRenderer.invoke('events:update', input),
    remove: (id, scope, occurrenceStartTs) => ipcRenderer.invoke('events:remove', id, scope, occurrenceStartTs),
    listExceptions: (eventId) => ipcRenderer.invoke('events:listExceptions', eventId)
  },
  categories: {
    list: () => ipcRenderer.invoke('categories:list')
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
  }
}

contextBridge.exposeInMainWorld('api', api)

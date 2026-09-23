import { create } from 'zustand'
import type { SyncCalendarDto, SyncStatus } from '@shared/events'

// A separate store, not a slice of useAppStore: Header calls useAppStore() with no
// selector, so folding sync status in there would re-render it on every status push
// (every 5 minutes, twice per run) for state most subscribers don't use. This store
// stays dumb (pure setters); all IPC lives in useSyncBridge.
export type BusyAction = 'connect' | 'disconnect' | 'sync' | null

interface SyncState {
  status: SyncStatus
  calendars: SyncCalendarDto[]
  settingsOpen: boolean
  busy: BusyAction
  openSettings(): void
  closeSettings(): void
  setStatus(s: SyncStatus): void
  setCalendars(c: SyncCalendarDto[]): void
  setBusy(b: BusyAction): void
}

const initialStatus: SyncStatus = { phase: 'disabled', connected: false, configured: false }

export const useSyncStore = create<SyncState>((set) => ({
  status: initialStatus,
  calendars: [],
  settingsOpen: false,
  busy: null,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setStatus: (s) => set({ status: s }),
  setCalendars: (c) => set({ calendars: c }),
  setBusy: (b) => set({ busy: b })
}))

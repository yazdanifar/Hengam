import { create } from 'zustand'
import type { HolidayStatus, SettingsSection, SyncCalendarDto, SyncStatus } from '@shared/events'

// Background-job state (Google sync and the holiday refresh) plus the settings dialog
// that manages both. A separate store, not a slice of useAppStore: Header calls
// useAppStore() with no selector, so folding status in there would re-render it on
// every status push for state most subscribers don't use. This store stays dumb (pure
// setters); all IPC lives in useMainBridge.
export type BusyAction = 'connect' | 'disconnect' | 'sync' | null

interface SyncState {
  status: SyncStatus
  holidayStatus: HolidayStatus
  calendars: SyncCalendarDto[]
  settingsOpen: boolean
  settingsSection: SettingsSection
  busy: BusyAction
  /** Opens settings, on `section` if given, else on whichever tab was last shown. */
  openSettings(section?: SettingsSection): void
  closeSettings(): void
  setSettingsSection(section: SettingsSection): void
  setStatus(s: SyncStatus): void
  setHolidayStatus(s: HolidayStatus): void
  setCalendars(c: SyncCalendarDto[]): void
  setBusy(b: BusyAction): void
}

const initialStatus: SyncStatus = { phase: 'disabled', connected: false, configured: false }

export const useSyncStore = create<SyncState>((set) => ({
  status: initialStatus,
  holidayStatus: { phase: 'idle' },
  calendars: [],
  settingsOpen: false,
  settingsSection: 'google',
  busy: null,
  openSettings: (section) => set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection })),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  setStatus: (s) => set({ status: s }),
  setHolidayStatus: (s) => set({ holidayStatus: s }),
  setCalendars: (c) => set({ calendars: c }),
  setBusy: (b) => set({ busy: b })
}))

import { create } from 'zustand'
import type { AppNotification } from '@shared/notifications'

/** The bell's inbox, newest first. Filled and kept current by useMainBridge. */
interface NotificationState {
  items: AppNotification[]
  setItems(items: AppNotification[]): void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  setItems: (items) => set({ items })
}))

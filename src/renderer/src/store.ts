import { create } from 'zustand'
import { addJalaliMonths, toGregorian, toJalali, type JalaliDate } from '@shared/jalali'

export type ViewMode = 'day' | 'week' | 'month'

interface AppState {
  view: ViewMode
  selectedDate: JalaliDate
  selectedGregorian: Date
  setView(v: ViewMode): void
  goToday(): void
  goto(d: Date): void
  step(dir: -1 | 1): void
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'day',
  selectedDate: toJalali(new Date()),
  selectedGregorian: new Date(new Date().setHours(0, 0, 0, 0)),
  setView: (v) => set({ view: v }),
  goToday: () => {
    const d = new Date(new Date().setHours(0, 0, 0, 0))
    set({ selectedGregorian: d, selectedDate: toJalali(d) })
  },
  goto: (d) => set({ selectedGregorian: d, selectedDate: toJalali(d) }),
  step: (dir) => {
    const { view, selectedGregorian, selectedDate } = get()
    if (view === 'month') {
      const j = addJalaliMonths(selectedDate.jy, selectedDate.jm, 1, dir)
      const g = toGregorian(j.jy, j.jm, 1)
      set({ selectedGregorian: g, selectedDate: toJalali(g) })
      return
    }
    const next = new Date(selectedGregorian)
    next.setDate(next.getDate() + dir * (view === 'week' ? 7 : 1))
    set({ selectedGregorian: next, selectedDate: toJalali(next) })
  }
}))

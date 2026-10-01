import { toFaDigits, formatTimeFromDate } from '@shared/format'
import { getDayInfo } from '@shared/holidays'
import { MONTH_NAMES, WEEKDAY_NAMES, weekdayIndex, type JalaliDate } from '@shared/jalali'
import type { Occurrence } from '@shared/types'
import type { HolidaySource } from '@shared/holidays'
import type { TrayMenuItem, TrayPort } from '../ports'

export interface TrayCallbacks {
  onShowWindow(): void
  onNewEvent(): void
  onSyncNow?(): void
  onQuit(): void
  onOpenEvent(occ: Occurrence): void
  isOpenAtLogin(): boolean
  onToggleOpenAtLogin(): void
}

export class TrayService {
  constructor(
    private tray: TrayPort,
    private holidays: HolidaySource,
    private callbacks: TrayCallbacks
  ) {}

  update(day: JalaliDate, dayDate: Date, todaysEvents: Occurrence[], googleConnected: boolean): void {
    const weekdayName = WEEKDAY_NAMES[weekdayIndex(dayDate)]
    const info = getDayInfo(day, this.holidays)
    const header = `${weekdayName} ${toFaDigits(day.jd)} ${MONTH_NAMES[day.jm - 1]} ${toFaDigits(day.jy)}`

    this.tray.setTitle(`${toFaDigits(day.jd)} ${MONTH_NAMES[day.jm - 1]}`, header)

    const items: TrayMenuItem[] = [
      { label: header },
      ...info.events.map((e) => ({ label: `${e.isHoliday ? '🔴 ' : ''}${e.title}` })),
      { type: 'separator' as const, label: '' },
      ...todaysEvents.map((o) => ({
        label: `${formatTimeFromDate(new Date(o.startTs))}–${formatTimeFromDate(new Date(o.endTs))}  ${o.title}`,
        onClick: () => this.callbacks.onOpenEvent(o)
      })),
      { type: 'separator' as const, label: '' },
      { label: 'نمایش هنگام', onClick: this.callbacks.onShowWindow },
      { label: 'رویداد جدید', onClick: this.callbacks.onNewEvent },
      ...(googleConnected && this.callbacks.onSyncNow
        ? [{ label: 'همگام‌سازی', onClick: this.callbacks.onSyncNow }]
        : []),
      { type: 'separator' as const, label: '' },
      {
        label: 'اجرا هنگام ورود به سیستم',
        type: 'checkbox' as const,
        checked: this.callbacks.isOpenAtLogin(),
        onClick: this.callbacks.onToggleOpenAtLogin
      },
      { type: 'separator' as const, label: '' },
      { label: 'خروج', onClick: this.callbacks.onQuit }
    ]
    this.tray.setMenuItems(items)
  }
}

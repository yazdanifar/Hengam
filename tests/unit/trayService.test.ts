import { describe, expect, it } from 'vitest'
import { TrayService, type TrayCallbacks } from '@main/services/TrayService'
import type { HolidaySource } from '@shared/holidays'
import type { TrayMenuItem } from '@main/ports'

const noHolidays: HolidaySource = { getYear: () => undefined }

class FakeTray {
  title = ''
  tooltip: string | undefined = ''
  items: TrayMenuItem[] = []
  setTitle(title: string, tooltip?: string): void {
    this.title = title
    this.tooltip = tooltip
  }
  setMenuItems(items: TrayMenuItem[]): void {
    this.items = items
  }
}

function buildCallbacks(overrides: Partial<TrayCallbacks> = {}): TrayCallbacks {
  return {
    onShowWindow: () => {},
    onNewEvent: () => {},
    onQuit: () => {},
    onOpenEvent: () => {},
    isOpenAtLogin: () => false,
    onToggleOpenAtLogin: () => {},
    ...overrides
  }
}

describe('TrayService', () => {
  it('passes the full Jalali date as the tooltip alongside the short title', () => {
    const tray = new FakeTray()
    const service = new TrayService(tray, noHolidays, buildCallbacks())

    service.update({ jy: 1405, jm: 6, jd: 31 }, new Date('2026-09-22'), [], false)

    expect(tray.title).toContain('۳۱')
    expect(tray.tooltip).toContain('۱۴۰۵')
    expect(tray.tooltip).toContain('۳۱')
  })

  it('shows the login-item toggle as unchecked when disabled', () => {
    const tray = new FakeTray()
    const service = new TrayService(tray, noHolidays, buildCallbacks({ isOpenAtLogin: () => false }))

    service.update({ jy: 1405, jm: 6, jd: 31 }, new Date('2026-09-22'), [], false)

    const toggle = tray.items.find((i) => i.label === 'اجرا هنگام ورود به سیستم')
    expect(toggle?.type).toBe('checkbox')
    expect(toggle?.checked).toBe(false)
  })

  it('shows the login-item toggle as checked when enabled', () => {
    const tray = new FakeTray()
    const service = new TrayService(tray, noHolidays, buildCallbacks({ isOpenAtLogin: () => true }))

    service.update({ jy: 1405, jm: 6, jd: 31 }, new Date('2026-09-22'), [], false)

    const toggle = tray.items.find((i) => i.label === 'اجرا هنگام ورود به سیستم')
    expect(toggle?.checked).toBe(true)
  })

  it('clicking the login-item toggle calls onToggleOpenAtLogin', () => {
    const tray = new FakeTray()
    let toggled = false
    const service = new TrayService(tray, noHolidays, buildCallbacks({ onToggleOpenAtLogin: () => (toggled = true) }))

    service.update({ jy: 1405, jm: 6, jd: 31 }, new Date('2026-09-22'), [], false)
    tray.items.find((i) => i.label === 'اجرا هنگام ورود به سیستم')?.onClick?.()

    expect(toggled).toBe(true)
  })

  it('clicking "نمایش هنگام" calls onShowWindow', () => {
    const tray = new FakeTray()
    let shown = false
    const service = new TrayService(tray, noHolidays, buildCallbacks({ onShowWindow: () => (shown = true) }))

    service.update({ jy: 1405, jm: 6, jd: 31 }, new Date('2026-09-22'), [], false)
    tray.items.find((i) => i.label === 'نمایش هنگام')?.onClick?.()

    expect(shown).toBe(true)
  })
})

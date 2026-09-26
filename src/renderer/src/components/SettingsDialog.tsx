import { useEffect, useId, useRef, useState } from 'react'
import type { SettingsSection } from '@shared/events'
import type { AlertSettings } from '@shared/notifications'
import { useApi } from '../apiContext'
import { useSyncStore } from '../syncStore'
import { useDialogA11y } from '../useDialogA11y'
import { GoogleSettingsPanel } from './Settings/GoogleSettingsPanel'
import { HolidaySettingsPanel } from './Settings/HolidaySettingsPanel'

interface Props {
  onClose(): void
}

const TABS: { key: SettingsSection; label: string }[] = [
  { key: 'google', label: 'تقویم گوگل' },
  { key: 'holidays', label: 'تعطیلات رسمی' }
]

// In RTL the next tab sits to the left, so ArrowLeft moves forward.
const KEY_STEP: Record<string, number> = { ArrowLeft: 1, ArrowRight: -1 }

/** Settings for the two background jobs — Google Calendar sync and the holiday refresh —
 *  each tab holding that job's status, a manual run, and its failure-alert threshold. */
export function SettingsDialog({ onClose }: Props) {
  const api = useApi()
  const { ref, dialogProps, titleId } = useDialogA11y(onClose)
  const section = useSyncStore((s) => s.settingsSection)
  const setSection = useSyncStore((s) => s.setSettingsSection)
  const syncFailing = useSyncStore((s) => s.status.failingSince !== undefined)
  const holidaysFailing = useSyncStore((s) => s.holidayStatus.failingSince !== undefined)
  const [alerts, setAlerts] = useState<AlertSettings | null>(null)
  const tabRefs = useRef<Partial<Record<SettingsSection, HTMLButtonElement | null>>>({})
  const baseId = useId()

  useEffect(() => {
    let cancelled = false
    api.settings.getAlerts().then((a) => {
      if (!cancelled) setAlerts(a)
    })
    return () => {
      cancelled = true
    }
  }, [api])

  function saveAlerts(patch: Partial<AlertSettings>): void {
    void api.settings.setAlerts(patch).then(setAlerts)
  }

  function onTabKeyDown(e: React.KeyboardEvent): void {
    const index = TABS.findIndex((t) => t.key === section)
    let next: number
    if (e.key in KEY_STEP) next = (index + KEY_STEP[e.key] + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    else return
    e.preventDefault()
    setSection(TABS[next].key)
    tabRefs.current[TABS[next].key]?.focus()
  }

  const failing: Record<SettingsSection, boolean> = { google: syncFailing, holidays: holidaysFailing }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog-settings" onClick={(e) => e.stopPropagation()} ref={ref} {...dialogProps}>
        <h2 id={titleId}>تنظیمات</h2>

        <div className="settings-tabs" role="tablist" aria-label="بخش‌های تنظیمات" onKeyDown={onTabKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.key}
              ref={(el) => (tabRefs.current[t.key] = el)}
              type="button"
              role="tab"
              id={`${baseId}-tab-${t.key}`}
              aria-selected={section === t.key}
              aria-controls={`${baseId}-panel`}
              tabIndex={section === t.key ? 0 : -1}
              className={section === t.key ? 'active' : ''}
              onClick={() => setSection(t.key)}
            >
              {t.label}
              {failing[t.key] && (
                <span className="tab-alert-dot" role="img" aria-label="ناموفق" />
              )}
            </button>
          ))}
        </div>

        <div
          className="settings-panel"
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-tab-${section}`}
        >
          {section === 'google' ? (
            <GoogleSettingsPanel alerts={alerts} onAlertsChange={saveAlerts} />
          ) : (
            <HolidaySettingsPanel alerts={alerts} onAlertsChange={saveAlerts} />
          )}
        </div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            بستن
          </button>
        </div>
      </div>
    </div>
  )
}

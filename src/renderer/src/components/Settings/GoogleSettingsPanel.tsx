import { useEffect, useState } from 'react'
import type { AlertSettings } from '@shared/notifications'
import { formatDurationFa } from '@shared/notifications'
import { formatRelativeFa } from '@shared/datetime'
import { useApi } from '../../apiContext'
import { useSyncStore } from '../../syncStore'
import { useNowTick } from '../../useNowTick'
import { useBackgroundActions } from '../../useBackgroundActions'
import { syncErrorMessage } from '../../syncMessages'
import { AlertThresholdField } from './AlertThresholdField'

interface Props {
  alerts: AlertSettings | null
  onAlertsChange(patch: Partial<AlertSettings>): void
}

export function GoogleSettingsPanel({ alerts, onAlertsChange }: Props) {
  const api = useApi()
  const { status, calendars, busy, setCalendars, setBusy, setStatus } = useSyncStore()
  const { syncing, syncNow } = useBackgroundActions()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const now = useNowTick().getTime()

  useEffect(() => {
    if (status.connected) {
      api.google.listCalendars().then(setCalendars)
    }
  }, [api, status.connected, setCalendars])

  async function handleConnect() {
    setBusy('connect')
    try {
      const s = await api.google.connect()
      setStatus(s)
      if (s.connected) setCalendars(await api.google.listCalendars())
    } finally {
      setBusy(null)
    }
  }

  async function handleDisconnect() {
    setBusy('disconnect')
    try {
      const s = await api.google.disconnect()
      setStatus(s)
      setCalendars([])
      setConfirmDisconnect(false)
    } finally {
      setBusy(null)
    }
  }

  async function toggleCalendar(calendarId: string, enabled: boolean) {
    setCalendars(calendars.map((c) => (c.calendarId === calendarId ? { ...c, enabled } : c)))
    await api.google.setCalendarEnabled(calendarId, enabled)
  }

  async function setDefaultTarget(calendarId: string) {
    setCalendars(calendars.map((c) => ({ ...c, isDefaultTarget: c.calendarId === calendarId })))
    await api.google.setDefaultTarget(calendarId)
  }

  if (!status.configured) {
    return <div className="settings-note">همگام‌سازی در این نسخه پیکربندی نشده است.</div>
  }

  if (status.phase === 'connecting') {
    return (
      <>
        <div className="settings-note">صفحهٔ ورود در مرورگر باز شد. پس از تأیید، به هنگام بازگردید.</div>
        <button className="btn btn-secondary" onClick={() => void api.google.cancelConnect()}>
          انصراف از اتصال
        </button>
      </>
    )
  }

  if (!status.connected) {
    return (
      <>
        <div className="settings-note">
          با اتصال حساب گوگل، رویدادهای هنگام با تقویم گوگل شما در هر دو جهت همگام می‌شوند: رویدادهای جدید، ویرایش‌ها
          و حذف‌ها.
        </div>
        <div className="settings-note">
          فقط عنوان، یادداشت، زمان، تکرار و یادآوری رویدادها ارسال می‌شود. کارها و یادداشت‌های روزانه ارسال نمی‌شوند.
        </div>
        {status.errorCode && <div className="status-line is-error">{syncErrorMessage(status.errorCode)}</div>}
        <button className="btn btn-primary" disabled={busy === 'connect'} onClick={handleConnect}>
          اتصال حساب گوگل
        </button>
      </>
    )
  }

  const statusText =
    status.phase === 'syncing'
      ? 'در حال همگام‌سازی…'
      : (syncErrorMessage(status.errorCode) ??
        (status.lastSuccessAt
          ? `آخرین همگام‌سازی: ${formatRelativeFa(status.lastSuccessAt, now)}`
          : 'هنوز همگام‌سازی نشده است'))

  return (
    <>
      <div className="account-row">
        <span>حساب متصل:</span>
        <span className="email">{status.email}</span>
        {!confirmDisconnect && (
          <button className="btn btn-danger-quiet btn-small" onClick={() => setConfirmDisconnect(true)}>
            قطع اتصال
          </button>
        )}
      </div>
      {confirmDisconnect && (
        <div className="confirm-row">
          <span className="settings-note">اتصال حساب گوگل قطع شود؟ رویدادهای شما در هنگام باقی می‌مانند.</span>
          <button className="btn btn-secondary btn-small" onClick={() => setConfirmDisconnect(false)}>
            انصراف
          </button>
          <button className="btn btn-danger btn-small" disabled={busy === 'disconnect'} onClick={handleDisconnect}>
            قطع اتصال
          </button>
        </div>
      )}

      <h3>تقویم‌هایی که همگام می‌شوند</h3>
      {calendars.length === 0 && <div className="empty-state">تقویمی پیدا نشد.</div>}
      <div className="cal-list">
        {calendars.map((cal) => (
          <div className="cal-row" key={cal.calendarId}>
            <input
              type="checkbox"
              id={`cal-enabled-${cal.calendarId}`}
              checked={cal.enabled}
              onChange={(e) => toggleCalendar(cal.calendarId, e.target.checked)}
            />
            <span className="cal-dot" style={{ background: cal.color ?? '#999' }} />
            <label htmlFor={`cal-enabled-${cal.calendarId}`} title={cal.summary}>
              {cal.summary}
            </label>
            <input
              type="radio"
              name="default-target"
              aria-label="تقویم پیش‌فرض برای رویدادهای جدید"
              disabled={!cal.enabled}
              title={!cal.enabled ? 'ابتدا این تقویم را فعال کنید' : undefined}
              checked={cal.isDefaultTarget}
              onChange={() => setDefaultTarget(cal.calendarId)}
            />
          </div>
        ))}
      </div>
      <button
        className="btn btn-secondary btn-small"
        onClick={async () => setCalendars(await api.google.refreshCalendars())}
      >
        به‌روزرسانی فهرست تقویم‌ها
      </button>

      <h3>وضعیت</h3>
      <div className="status-row">
        <div className={`status-line${status.phase === 'error' ? ' is-error' : ''}`} role="status">
          {statusText}
        </div>
        <button className="btn btn-primary btn-small" disabled={syncing} onClick={() => void syncNow()}>
          همگام‌سازی
        </button>
      </div>
      {status.failingSince !== undefined && status.phase !== 'syncing' && (
        <div className="status-line is-error">همگام‌سازی از {formatDurationFa(now - status.failingSince)} پیش ناموفق است.</div>
      )}

      {alerts && (
        <AlertThresholdField
          subject="همگام‌سازی"
          initialMinutes={alerts.syncFailureMin}
          onChange={(syncFailureMin) => onAlertsChange({ syncFailureMin })}
        />
      )}
    </>
  )
}

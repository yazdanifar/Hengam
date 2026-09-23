import { useEffect, useState } from 'react'
import { useApi } from '../apiContext'
import { useSyncStore } from '../syncStore'
import { useDialogA11y } from '../useDialogA11y'
import { syncErrorMessage } from '../syncMessages'
import { formatRelativeFa } from '@shared/datetime'
import { useNowTick } from '../useNowTick'

interface Props {
  onClose(): void
}

export function SettingsDialog({ onClose }: Props) {
  const api = useApi()
  const { ref, dialogProps, titleId } = useDialogA11y(onClose)
  const { status, calendars, busy, setCalendars, setBusy, setStatus } = useSyncStore()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const now = useNowTick()

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

  async function handleCancelConnect() {
    await api.google.cancelConnect()
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

  async function handleSyncNow() {
    setBusy('sync')
    try {
      setStatus(await api.google.syncNow())
    } finally {
      setBusy(null)
    }
  }

  async function handleRefreshCalendars() {
    setCalendars(await api.google.refreshCalendars())
  }

  async function toggleCalendar(calendarId: string, enabled: boolean) {
    setCalendars(calendars.map((c) => (c.calendarId === calendarId ? { ...c, enabled } : c)))
    await api.google.setCalendarEnabled(calendarId, enabled)
  }

  async function setDefaultTarget(calendarId: string) {
    setCalendars(calendars.map((c) => ({ ...c, isDefaultTarget: c.calendarId === calendarId })))
    await api.google.setDefaultTarget(calendarId)
  }

  const errorText = syncErrorMessage(status.errorCode)

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()} ref={ref} {...dialogProps}>
        <h2 id={titleId}>تنظیمات همگام‌سازی</h2>

        <div className="settings-section">
          <h3>تقویم گوگل</h3>

          {!status.configured && (
            <div className="settings-note">همگام‌سازی در این نسخه پیکربندی نشده است.</div>
          )}

          {status.configured && !status.connected && status.phase !== 'connecting' && (
            <>
              <div className="settings-note">
                با اتصال حساب گوگل، رویدادهای هنگام با تقویم گوگل شما در هر دو جهت همگام می‌شوند: رویدادهای جدید،
                ویرایش‌ها و حذف‌ها.
              </div>
              <div className="settings-note">
                فقط عنوان، یادداشت، زمان، تکرار و یادآوری رویدادها ارسال می‌شود. کارها و یادداشت‌های روزانه ارسال
                نمی‌شوند.
              </div>
              <button className="btn btn-primary" disabled={busy === 'connect'} onClick={handleConnect}>
                اتصال حساب گوگل
              </button>
            </>
          )}

          {status.phase === 'connecting' && (
            <>
              <div className="settings-note">صفحهٔ ورود در مرورگر باز شد. پس از تأیید، به هنگام بازگردید.</div>
              <button className="btn btn-secondary" onClick={handleCancelConnect}>
                انصراف از اتصال
              </button>
            </>
          )}

          {status.connected && (
            <>
              <div className="account-row">
                <span>حساب متصل:</span>
                <span className="email">{status.email}</span>
              </div>

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
              <button className="btn btn-secondary" onClick={handleRefreshCalendars}>
                به‌روزرسانی فهرست تقویم‌ها
              </button>

              <div className={`status-line${status.phase === 'error' ? ' is-error' : ''}`} style={{ marginTop: 12 }}>
                {status.phase === 'syncing'
                  ? 'در حال همگام‌سازی…'
                  : errorText ?? (status.lastSuccessAt ? `آخرین همگام‌سازی: ${formatRelativeFa(status.lastSuccessAt, now.getTime())}` : 'هنوز همگام‌سازی نشده است')}
              </div>
            </>
          )}
        </div>

        <div className="dialog-actions">
          {status.connected && !confirmDisconnect && (
            <button className="btn btn-danger" onClick={() => setConfirmDisconnect(true)}>
              قطع اتصال
            </button>
          )}
          {confirmDisconnect && (
            <>
              <span className="settings-note" style={{ marginInlineEnd: 'auto' }}>
                اتصال حساب گوگل قطع شود؟ رویدادهای شما در هنگام باقی می‌مانند.
              </span>
              <button className="btn btn-secondary" onClick={() => setConfirmDisconnect(false)}>
                انصراف
              </button>
              <button className="btn btn-danger" disabled={busy === 'disconnect'} onClick={handleDisconnect}>
                قطع اتصال
              </button>
            </>
          )}
          {status.connected && !confirmDisconnect && (
            <button className="btn btn-primary" disabled={busy === 'sync'} onClick={handleSyncNow}>
              همگام‌سازی
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>
            بستن
          </button>
        </div>
      </div>
    </div>
  )
}

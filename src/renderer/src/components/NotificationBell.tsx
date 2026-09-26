import { useEffect, useId, useRef, useState } from 'react'
import { ALERT_TITLES, alertBody, isActiveAlert, type AlertKind, type AppNotification } from '@shared/notifications'
import { formatRelativeFa } from '@shared/datetime'
import { toFaDigits } from '@shared/format'
import { useApi } from '../apiContext'
import { useNotificationStore } from '../notificationStore'
import { useSyncStore } from '../syncStore'
import { useAppStore } from '../store'
import { useNowTick } from '../useNowTick'
import { useBackgroundActions } from '../useBackgroundActions'
import { holidayErrorMessage, syncErrorMessage } from '../syncMessages'
import { AlertIcon, BellIcon, CalendarClockIcon, CheckCircleIcon, CloseIcon } from './icons'

/**
 * The header bell: an unread-count badge, turning red while a background job has an
 * active failure alert. Opening it marks everything read and shows a panel with any
 * active alerts pinned on top ("needs attention", with fix-it actions) above the recent
 * list of fired reminders and resolved alerts.
 */
export function NotificationBell() {
  const api = useApi()
  const items = useNotificationStore((s) => s.items)
  const [open, setOpen] = useState(false)
  // What was unread when the panel opened: still highlighted as new while it stays open,
  // even though opening marks everything read.
  const [newIds, setNewIds] = useState<ReadonlySet<number>>(new Set())
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const unreadCount = items.filter((n) => n.readAt === undefined).length
  const hasActiveAlert = items.some(isActiveAlert)

  function openPanel(): void {
    setNewIds(new Set(items.filter((n) => n.readAt === undefined).map((n) => n.id)))
    setOpen(true)
    if (unreadCount > 0) void api.notifications.markAllRead()
  }

  function closePanel(restoreFocus: boolean): void {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  const label = [
    'اعلان‌ها',
    unreadCount > 0 ? `${toFaDigits(unreadCount)} خوانده‌نشده` : null,
    hasActiveAlert ? 'نیازمند توجه' : null
  ]
    .filter(Boolean)
    .join('، ')

  return (
    <div className="bell-wrap">
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn bell-btn${hasActiveAlert ? ' has-alert' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? closePanel(true) : openPanel())}
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span className="bell-badge" aria-hidden>
            {unreadCount > 9 ? '۹+' : toFaDigits(unreadCount)}
          </span>
        ) : (
          hasActiveAlert && <span className="bell-dot" aria-hidden />
        )}
      </button>
      {open && (
        <NotificationPanel id={panelId} items={items} newIds={newIds} anchorRef={buttonRef} onClose={closePanel} />
      )}
    </div>
  )
}

interface PanelProps {
  id: string
  items: AppNotification[]
  newIds: ReadonlySet<number>
  anchorRef: React.RefObject<HTMLButtonElement>
  onClose(restoreFocus: boolean): void
}

function NotificationPanel({ id, items, newIds, anchorRef, onClose }: PanelProps) {
  const api = useApi()
  const ref = useRef<HTMLDivElement>(null)
  const now = useNowTick().getTime()
  const active = items.filter(isActiveAlert)
  const recent = items.filter((n) => !isActiveAlert(n))

  // The parent re-creates onClose every render; reading it through a ref keeps the
  // listeners below (and the one-time focus move) from re-running on each clock tick.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    ref.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current(true)
      }
    }
    // Clicking anywhere else closes it without stealing focus back from what was clicked.
    function onPointerDown(e: MouseEvent): void {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !anchorRef.current?.contains(target)) onCloseRef.current(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [anchorRef])

  return (
    <div className="notif-panel" id={id} role="dialog" aria-label="اعلان‌ها" tabIndex={-1} ref={ref}>
      <div className="notif-panel-head">
        <h2>اعلان‌ها</h2>
        {recent.length > 0 && (
          <button type="button" className="link-btn" onClick={() => void api.notifications.clearAll()}>
            پاک کردن همه
          </button>
        )}
      </div>

      {active.length > 0 && (
        <section className="notif-attention" aria-label="نیازمند توجه">
          <h3>نیازمند توجه</h3>
          {active.map((n) => (
            <AlertCard key={n.id} alert={n} now={now} onNavigate={() => onClose(true)} />
          ))}
        </section>
      )}

      {recent.length > 0 && (
        <ul className="notif-list" aria-label="اعلان‌های اخیر">
          {recent.map((n) => (
            <NotificationItem key={n.id} n={n} isNew={newIds.has(n.id)} now={now} onNavigate={() => onClose(true)} />
          ))}
        </ul>
      )}

      {items.length === 0 && (
        <div className="notif-empty">
          <BellIcon />
          <p>اعلان تازه‌ای ندارید</p>
          <p className="notif-empty-hint">یادآوری رویدادها و هشدارهای همگام‌سازی اینجا نمایش داده می‌شوند.</p>
        </div>
      )}
    </div>
  )
}

function AlertCard({ alert, now, onNavigate }: { alert: AppNotification; now: number; onNavigate(): void }) {
  const kind = alert.kind as AlertKind
  const openSettings = useSyncStore((s) => s.openSettings)
  const syncErrorCode = useSyncStore((s) => s.status.errorCode)
  const holidayErrorCode = useSyncStore((s) => s.holidayStatus.errorCode)
  const { syncing, syncNow, refreshingHolidays, refreshHolidays } = useBackgroundActions()

  const isSync = kind === 'sync_failure'
  const reason = isSync ? syncErrorMessage(syncErrorCode) : holidayErrorMessage(holidayErrorCode)
  const retrying = isSync ? syncing : refreshingHolidays

  return (
    <div className="alert-card" role="group" aria-label={ALERT_TITLES[kind]}>
      <span className="alert-card-icon">
        <AlertIcon />
      </span>
      <div className="alert-card-body">
        <div className="alert-card-title">{ALERT_TITLES[kind]}</div>
        <div className="alert-card-text">{alertBody(kind, alert.failingSince!, now)}</div>
        {reason && <div className="alert-card-reason">{reason}</div>}
        <div className="alert-card-actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={retrying}
            onClick={() => void (isSync ? syncNow() : refreshHolidays())}
          >
            {retrying ? 'در حال تلاش…' : 'تلاش دوباره'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => {
              // Close first so focus is back on the bell when the dialog records where to return it.
              onNavigate()
              openSettings(isSync ? 'google' : 'holidays')
            }}
          >
            تنظیمات
          </button>
        </div>
      </div>
    </div>
  )
}

interface ItemProps {
  n: AppNotification
  isNew: boolean
  now: number
  onNavigate(): void
}

function NotificationItem({ n, isNew, now, onNavigate }: ItemProps) {
  const api = useApi()
  const goto = useAppStore((s) => s.goto)
  const isReminder = n.kind === 'reminder'
  const title = isReminder ? n.title : ALERT_TITLES[n.kind as AlertKind]
  const text = isReminder ? n.body : `مشکل ${formatRelativeFa(n.resolvedAt!, now)} برطرف شد.`

  const content = (
    <>
      <span className={`notif-icon notif-icon-${isReminder ? 'reminder' : 'resolved'}`}>
        {isReminder ? <CalendarClockIcon /> : <CheckCircleIcon />}
      </span>
      <span className="notif-text">
        <span className="notif-title">
          {isNew && <span className="visually-hidden">جدید: </span>}
          {title}
        </span>
        {text && <span className="notif-body">{text}</span>}
        <span className="notif-time">{formatRelativeFa(n.createdAt, now)}</span>
      </span>
    </>
  )

  return (
    <li className={`notif-item${isNew ? ' is-new' : ''}`}>
      {isReminder && n.eventStartTs !== undefined ? (
        <button
          type="button"
          className="notif-main"
          title="نمایش روز این رویداد"
          onClick={() => {
            const day = new Date(n.eventStartTs!)
            day.setHours(0, 0, 0, 0)
            goto(day)
            onNavigate()
          }}
        >
          {content}
        </button>
      ) : (
        <div className="notif-main">{content}</div>
      )}
      <button
        type="button"
        className="icon-btn notif-dismiss"
        aria-label={`حذف اعلان «${title}»`}
        onClick={() => void api.notifications.dismiss(n.id)}
      >
        <CloseIcon />
      </button>
    </li>
  )
}

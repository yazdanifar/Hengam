import { useEffect, useState } from 'react'
import { MONTH_NAMES, WEEKDAY_NAMES, weekdayIndex } from '@shared/jalali'
import { toFaDigits } from '@shared/format'
import { useAppStore, type ViewMode } from '../store'
import { useSyncStore } from '../syncStore'

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: 'day', label: 'روز' },
  { key: 'week', label: 'هفته' },
  { key: 'month', label: 'ماه' }
]

const PILL_LABELS: Record<'idle' | 'syncing' | 'error', string> = {
  idle: 'همگام‌سازی به‌روز است',
  syncing: 'در حال همگام‌سازی',
  error: 'همگام‌سازی ناموفق بود'
}

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

function PillIcon({ phase }: { phase: 'idle' | 'syncing' | 'error' }) {
  if (phase === 'syncing') {
    return (
      <svg {...ICON_PROPS} strokeWidth={2.5} strokeDasharray="42" strokeDashoffset="14">
        <circle cx="12" cy="12" r="9" />
      </svg>
    )
  }
  if (phase === 'error') {
    return (
      <svg {...ICON_PROPS}>
        <line x1="12" y1="7" x2="12" y2="13" />
        <line x1="12" y1="16.5" x2="12" y2="16.51" />
      </svg>
    )
  }
  return (
    <svg {...ICON_PROPS}>
      <polyline points="5 12.5 10 17 19 7" />
    </svg>
  )
}

/** Suppresses the syncing pill for runs under 400ms — a 5-minute timer flashing an icon
 *  on every tick would be visual noise for what's usually an instant no-op run. */
function useDelayedSyncing(isSyncing: boolean): boolean {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!isSyncing) {
      setShow(false)
      return
    }
    const id = window.setTimeout(() => setShow(true), 400)
    return () => window.clearTimeout(id)
  }, [isSyncing])
  return show
}

function SyncPill() {
  const status = useSyncStore((s) => s.status)
  const openSettings = useSyncStore((s) => s.openSettings)
  const showSyncing = useDelayedSyncing(status.phase === 'syncing')

  if (!status.configured || !status.connected) return null
  const phase = status.phase === 'error' ? 'error' : showSyncing ? 'syncing' : 'idle'
  const label = PILL_LABELS[phase]

  return (
    <span
      className={`sync-pill sync-pill-${phase}`}
      role="status"
      aria-live="polite"
      title={label}
      aria-label={label}
      onClick={phase === 'error' ? openSettings : undefined}
    >
      <PillIcon phase={phase} />
    </span>
  )
}

export function Header() {
  const { view, setView, selectedDate, selectedGregorian, goToday, step } = useAppStore()
  const openSettings = useSyncStore((s) => s.openSettings)
  const weekday = WEEKDAY_NAMES[weekdayIndex(selectedGregorian)]
  const gregLabel = selectedGregorian.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })

  return (
    <div className="header">
      <button className="nav-btn" onClick={() => step(-1)} aria-label="قبلی">
        ‹
      </button>
      <button className="today-btn" onClick={goToday}>
        امروز
      </button>
      <button className="nav-btn" onClick={() => step(1)} aria-label="بعدی">
        ›
      </button>
      <div className="date-title">
        <span className="jalali">
          {weekday} {toFaDigits(selectedDate.jd)} {MONTH_NAMES[selectedDate.jm - 1]} {toFaDigits(selectedDate.jy)}
        </span>
        <span className="greg" dir="ltr">
          {gregLabel}
        </span>
      </div>
      <div className="view-switcher" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            className={view === v.key ? 'active' : ''}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
      <SyncPill />
      <button className="nav-btn settings-btn" aria-label="تنظیمات" onClick={openSettings}>
        ⚙
      </button>
    </div>
  )
}

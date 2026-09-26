import { MONTH_NAMES, WEEKDAY_NAMES, weekdayIndex } from '@shared/jalali'
import { toFaDigits } from '@shared/format'
import { useAppStore, type ViewMode } from '../store'
import { useSyncStore } from '../syncStore'
import { NotificationBell } from './NotificationBell'
import { GearIcon } from './icons'

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: 'day', label: 'روز' },
  { key: 'week', label: 'هفته' },
  { key: 'month', label: 'ماه' }
]

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
      <NotificationBell />
      <button type="button" className="icon-btn" aria-label="تنظیمات" title="تنظیمات" onClick={() => openSettings()}>
        <GearIcon />
      </button>
    </div>
  )
}

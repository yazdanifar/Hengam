import type { AlertSettings } from '@shared/notifications'
import { formatDurationFa } from '@shared/notifications'
import { formatRelativeFa, formatUntilFa } from '@shared/datetime'
import { useSyncStore } from '../../syncStore'
import { useNowTick } from '../../useNowTick'
import { useBackgroundActions } from '../../useBackgroundActions'
import { holidayErrorMessage } from '../../syncMessages'
import { AlertIcon } from '../icons'
import { AlertThresholdField } from './AlertThresholdField'

interface Props {
  alerts: AlertSettings | null
  onAlertsChange(patch: Partial<AlertSettings>): void
}

export function HolidaySettingsPanel({ alerts, onAlertsChange }: Props) {
  const status = useSyncStore((s) => s.holidayStatus)
  const { refreshingHolidays, refreshHolidays } = useBackgroundActions()
  const now = useNowTick().getTime()

  let next: string
  if (refreshingHolidays) next = 'در حال انجام…'
  else if (status.nextAttemptAt === undefined) next = '—'
  else next = formatUntilFa(status.nextAttemptAt, now)

  return (
    <>
      <div className="settings-note">
        فهرست تعطیلات و مناسبت‌های رسمی هر روز به‌طور خودکار از time.ir دریافت می‌شود. اگر دریافت ناموفق باشد، با فاصله‌های
        فزاینده و دست‌کم روزی یک بار دوباره تلاش می‌شود. تا آن زمان آخرین فهرست دریافت‌شده نمایش داده می‌شود.
      </div>

      <dl className="status-grid">
        <dt>آخرین به‌روزرسانی</dt>
        <dd>{status.lastSuccessAt ? formatRelativeFa(status.lastSuccessAt, now) : 'هنوز انجام نشده'}</dd>
        <dt>به‌روزرسانی بعدی</dt>
        <dd>{next}</dd>
      </dl>

      {status.failingSince !== undefined && !refreshingHolidays && (
        <div className="status-callout" role="status">
          <AlertIcon />
          <div>
            <strong>دریافت از {formatDurationFa(now - status.failingSince)} پیش ناموفق است.</strong>{' '}
            {holidayErrorMessage(status.errorCode)}
          </div>
        </div>
      )}

      <button className="btn btn-secondary btn-small" disabled={refreshingHolidays} onClick={() => void refreshHolidays()}>
        {refreshingHolidays ? 'در حال به‌روزرسانی…' : 'به‌روزرسانی'}
      </button>

      {alerts && (
        <AlertThresholdField
          subject="دریافت تعطیلات"
          initialMinutes={alerts.holidayFailureMin}
          onChange={(holidayFailureMin) => onAlertsChange({ holidayFailureMin })}
        />
      )}
    </>
  )
}

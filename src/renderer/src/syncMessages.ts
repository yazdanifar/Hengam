import type { HolidayErrorCode, SyncErrorCode } from '@shared/events'

/** All Persian text for background-job errors lives here, so raw Google/time.ir/English
 *  text never lands in the RTL UI — main only ever sends a stable `code` across IPC. */
export const SYNC_ERROR_MESSAGES: Record<SyncErrorCode, string> = {
  not_configured: 'همگام‌سازی پیکربندی نشده است.',
  not_connected: 'حساب گوگلی متصل نیست.',
  reauth_required: 'دسترسی به حساب گوگل منقضی شده است. دوباره متصل شوید.',
  cancelled: 'اتصال لغو شد.',
  denied: 'دسترسی به تقویم گوگل داده نشد.',
  state_mismatch: 'پاسخ ورود معتبر نبود. دوباره تلاش کنید.',
  token_exchange_failed: 'دریافت مجوز از گوگل ناموفق بود.',
  network: 'اتصال به اینترنت برقرار نیست.',
  rate_limited: 'گوگل درخواست‌ها را موقتاً محدود کرده است. بعداً دوباره تلاش می‌شود.',
  server: 'سرویس گوگل در دسترس نیست. بعداً دوباره تلاش می‌شود.',
  conflict: 'برخی رویدادها هم‌زمان در جای دیگری تغییر کرده بودند؛ تازه‌ترین نسخه نگه داشته شد.',
  sync_token_expired: 'همگام‌سازی کامل دوباره انجام می‌شود.',
  unknown: 'همگام‌سازی ناموفق بود.'
}

export function syncErrorMessage(code: SyncErrorCode | undefined): string | undefined {
  return code ? SYNC_ERROR_MESSAGES[code] : undefined
}

export const HOLIDAY_ERROR_MESSAGES: Record<HolidayErrorCode, string> = {
  network: 'اتصال به time.ir برقرار نشد.',
  blocked: 'time.ir درخواست را نپذیرفت.',
  server: 'time.ir در دسترس نبود.',
  site_changed: 'ساختار سایت time.ir تغییر کرده است؛ به‌روزرسانی برنامه لازم است.',
  invalid_data: 'اطلاعات دریافتی از time.ir ناقص بود.',
  unknown: 'دریافت تعطیلات ناموفق بود.'
}

export function holidayErrorMessage(code: HolidayErrorCode | undefined): string | undefined {
  return code ? HOLIDAY_ERROR_MESSAGES[code] : undefined
}

import type { SyncErrorCode } from '@shared/events'

/** All Persian text for sync errors lives here, so raw Google/English text never lands
 *  in the RTL UI — main only ever sends a stable `code` across IPC. */
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

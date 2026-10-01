// Google Calendar's event color palette (the `event` section of the Colors API), so a color
// picked in Hengam shows as the same color in Google Calendar after sync.
export const GOOGLE_EVENT_COLORS: { id: string; hex: string; label: string }[] = [
  { id: '7', hex: '#46d6db', label: 'طاووسی' },
  { id: '9', hex: '#5484ed', label: 'بلوبری' },
  { id: '1', hex: '#a4bdfc', label: 'اسطوخودوس' },
  { id: '3', hex: '#dbadff', label: 'انگوری' },
  { id: '4', hex: '#ff887c', label: 'فلامینگو' },
  { id: '11', hex: '#dc2127', label: 'گوجه‌ای' },
  { id: '6', hex: '#ffb878', label: 'نارنگی' },
  { id: '5', hex: '#fbd75b', label: 'موزی' },
  { id: '2', hex: '#7ae7bf', label: 'مریم‌گلی' },
  { id: '10', hex: '#51b749', label: 'ریحانی' },
  { id: '8', hex: '#e1e1e1', label: 'گرافیتی' }
]

/** Google's "Blueberry". */
export const DEFAULT_PICKER_COLOR = '#5484ed'

const DARK_TEXT = '#1d1d1d'
const LIGHT_TEXT = '#ffffff'

function luminance(hex: string): number {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean
  const n = parseInt(full, 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Dark or white text, whichever has the higher WCAG contrast against `background`. Most of
 *  Google's palette is pale, so white text on every event is unreadable. */
export function textColorOn(background: string): string {
  const l = luminance(background)
  const contrastDark = (l + 0.05) / (luminance(DARK_TEXT) + 0.05)
  const contrastLight = (1.05) / (l + 0.05)
  return contrastDark >= contrastLight ? DARK_TEXT : LIGHT_TEXT
}

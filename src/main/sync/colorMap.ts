// Pure hex <-> Google event colorId mapping, by nearest color in RGB space.

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

/** Nearest Google event colorId for a hex event color, by RGB distance in the palette. */
export function colorIdForHex(hex: string, palette: Record<string, { background: string }>): string {
  const target = hexToRgb(hex)
  let best: string | undefined
  let bestDist = Infinity
  for (const [id, entry] of Object.entries(palette)) {
    const d = distance(target, hexToRgb(entry.background))
    if (d < bestDist) {
      bestDist = d
      best = id
    }
  }
  if (!best) throw new Error('colorIdForHex: palette is empty')
  return best
}

/** Hex color for an inbound Google colorId; falls back to `fallbackHex` when there's no
 *  colorId or no palette entry for it. */
export function hexForColorId(
  colorId: string | undefined,
  palette: Record<string, { background: string }>,
  fallbackHex: string
): string {
  if (!colorId || !palette[colorId]) return fallbackHex
  return palette[colorId].background
}

/** Hex color to store for an inbound colorId. Google only has a small palette, so a
 *  custom local color is pushed as its nearest colorId; when that same colorId comes back
 *  the local color is kept rather than snapped to the palette swatch. */
export function resolveInboundHex(
  colorId: string | undefined,
  palette: Record<string, { background: string }>,
  currentHex: string | undefined,
  fallbackHex: string
): string {
  if (colorId && currentHex && palette[colorId] && colorIdForHex(currentHex, palette) === colorId) {
    return currentHex
  }
  return hexForColorId(colorId, palette, fallbackHex)
}

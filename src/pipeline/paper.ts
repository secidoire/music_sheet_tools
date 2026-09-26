/**
 * Physical page size handling.
 *
 * The pipeline works in millimetres (tolerances, margins, "don't enlarge past the original
 * size"), so it needs to know how large the paper really was. PDFs usually say so, but
 * scanner software sometimes writes a size that is off by a factor (e.g. a 300dpi scan
 * stored as if it were 150dpi, giving an 850mm "A3"). Images carry no usable size at all.
 */

/** Long side of the paper assumed when the real size is unknown: A4, or an A4 spread (A3) when clearly landscape. */
export function assumedLongMm(width: number, height: number): number {
  return width / height > 1.15 ? 420 : 297
}

/** Declared sizes outside this range (long side, mm) are taken to be wrong. B5 .. A3 with slack. */
const PLAUSIBLE_LONG_MM = [180, 460] as const

/**
 * Factor to apply to a PDF page's declared size to get its real size: 1 when the declared
 * size is plausible, otherwise the factor that makes it A4 / A3 (see `assumedLongMm`).
 */
export function pageSizeCorrection(widthMm: number, heightMm: number): number {
  const long = Math.max(widthMm, heightMm)
  if (long >= PLAUSIBLE_LONG_MM[0] && long <= PLAUSIBLE_LONG_MM[1]) return 1
  return assumedLongMm(widthMm, heightMm) / long
}

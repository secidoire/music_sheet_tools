import type { GrayImage } from './types.ts'
import { smooth1d } from './image.ts'

export interface SplitResult {
  /** Split position as a fraction of the page width. */
  x: number
  method: 'gutter' | 'shadow' | 'center'
  /** Column profiles over the search window, kept for debug plots. */
  debug: { x0: number; ink: Float64Array; brightness: Float64Array }
}

/** Search window around the page centre, as a fraction of the width (±10%). */
const SEARCH = 0.1

/**
 * Finds the gutter of a two-page spread.
 *
 * Priority:
 * 1. The widest ink-free column band (the white gutter). Thin page-edge lines
 *    inside it are bridged over.
 * 2. A broad binding shadow: a clear dip in the column brightness.
 * 3. A binding crease: a dark vertical line through almost every row.
 *    (Checked last: aligned clefs at the start of each staff also form a tall,
 *    ink-dense column and must not win over a real gutter.)
 * 4. The geometric centre.
 *
 * @param gray  page image
 * @param ink   ink mask for `gray` (1 = ink)
 * @param dpi   resolution of `gray`, used to express tolerances in millimetres
 */
export function detectSplit(gray: GrayImage, ink: Uint8Array, dpi: number): SplitResult {
  const { width: w, height: h } = gray
  const mm = dpi / 25.4
  const x0 = Math.floor(w * (0.5 - SEARCH))
  const x1 = Math.ceil(w * (0.5 + SEARCH))
  const n = x1 - x0
  // Ignore the outer rows: scanner edges and page borders are unreliable there.
  const y0 = Math.floor(h * 0.03)
  const y1 = Math.ceil(h * 0.97)
  const rows = y1 - y0

  const inkCol = new Float64Array(n)
  const brightCol = new Float64Array(n)
  for (let y = y0; y < y1; y++) {
    const row = y * w
    for (let i = 0; i < n; i++) {
      inkCol[i] += ink[row + x0 + i]
      brightCol[i] += gray.data[row + x0 + i]
    }
  }
  for (let i = 0; i < n; i++) {
    inkCol[i] /= rows
    brightCol[i] /= rows
  }
  const debug = { x0, ink: inkCol, brightness: brightCol }
  const toFrac = (i: number) => (x0 + i) / w

  // 1. Gutter.
  const is = smooth1d(inkCol, Math.round(0.5 * mm))
  const gaps = runs(is, (v) => v < 0.012, Math.round(1.5 * mm))
  if (gaps.length) {
    let best = gaps[0]
    for (const g of gaps) if (g.end - g.start > best.end - best.start) best = g
    if (best.end - best.start >= 4 * mm) return { x: toFrac((best.start + best.end) / 2), method: 'gutter', debug }
  }

  // 2. Broad shadow: brightness dip much darker than the surrounding paper.
  const bs = smooth1d(brightCol, Math.round(3 * mm))
  const sorted = [...bs].sort((a, b) => a - b)
  const paper = sorted[Math.floor(sorted.length * 0.8)]
  let minI = 0
  for (let i = 1; i < n; i++) if (bs[i] < bs[minI]) minI = i
  if (paper - bs[minI] > 30) return { x: toFrac(minI), method: 'shadow', debug }

  // 3. Crease.
  const crease = runs(inkCol, (v) => v > 0.7, Math.round(1 * mm))
  if (crease.length) {
    const c = closestTo(crease, n / 2)
    return { x: toFrac((c.start + c.end) / 2), method: 'shadow', debug }
  }

  return { x: 0.5, method: 'center', debug }
}

interface Run {
  start: number
  end: number
}

/** Contiguous index ranges where `pred` holds, merging runs separated by gaps ≤ `bridge`. */
function runs(a: Float64Array, pred: (v: number) => boolean, bridge: number): Run[] {
  const out: Run[] = []
  for (let i = 0; i < a.length; i++) {
    if (!pred(a[i])) continue
    const last = out[out.length - 1]
    if (last && i - last.end <= bridge + 1) last.end = i
    else out.push({ start: i, end: i })
  }
  return out
}

function closestTo(rs: Run[], c: number): Run {
  let best = rs[0]
  const d = (r: Run) => Math.abs((r.start + r.end) / 2 - c)
  for (const r of rs) if (d(r) < d(best)) best = r
  return best
}

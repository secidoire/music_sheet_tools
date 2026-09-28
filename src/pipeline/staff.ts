import type { CV, GrayImage } from './types.ts'
import { inkMask } from './image.ts'
import { detectSkew, horizontalStrokes } from './deskew.ts'

export interface Staff {
  /** Horizontal extent of the staff lines. */
  x0: number
  x1: number
  /** y of the top and bottom staff line (averaged over the staff). */
  top: number
  bottom: number
  /** Distance between adjacent staff lines. */
  spacing: number
  /** Top-line y sampled along the staff (one point per strip); kept for curvature correction. */
  samples: { x: number; top: number }[]
}

export interface StaffDetection {
  staves: Staff[]
  /** Masks the staves were found on, reused by callers (orientation check). */
  ink: Uint8Array
  strokes: Uint8Array
}

/** Staff-line spacing range accepted, in millimetres (miniature scores .. large-print parts). */
const MIN_SPACING_MM = 0.9
const MAX_SPACING_MM = 4

/**
 * Finds five-line staves in a page that may still be tilted by a few degrees.
 *
 * The page is cut into narrow vertical strips. In each strip the row profile of the
 * horizontal-stroke mask — taken along the page's overall skew, so that a thin tilted
 * line stays in one or two rows — shows staff lines as thin rows covering most of the strip;
 * five of them at an even spacing form a staff segment. Segments are then chained
 * across strips, which tolerates gentle curvature, and the exact left/right ends are
 * read from the columns where the lines are actually present.
 */
export function detectStaves(cv: CV, gray: GrayImage, dpi: number, pre?: { ink: Uint8Array; strokes: Uint8Array }): StaffDetection {
  const { width: w, height: h } = gray
  const mm = dpi / 25.4
  // `pre`: the same masks, already computed by the caller (see `pageView` in process.ts).
  const ink = pre?.ink ?? inkMask(cv, gray, 4 * mm)
  const strokes = pre?.strokes ?? horizontalStrokes(cv, ink, w, h, dpi)

  const sw = Math.max(16, Math.round(12 * mm))
  // +1: the profile below ORs two rows, which thickens every line by one row.
  const maxThick = Math.max(3, Math.round(0.6 * mm)) + 1
  const t = Math.tan((detectSkew(cv, strokes, w, { x: 0, y: 0, width: w, height: h }).angle * Math.PI) / 180)
  const segs: Seg[] = []
  const profile = new Float64Array(h)
  for (let sx = 0, k = 0; sx + sw / 2 <= w; sx += sw, k++) {
    const ex = Math.min(w, sx + sw)
    const xc = (sx + ex) / 2
    profile.fill(0)
    for (let x = sx; x < ex; x++) {
      // Row y of the profile is the row the line through (xc, y) has reached at column x.
      const shift = Math.round((x - xc) * t)
      for (let y = Math.max(0, -shift); y < Math.min(h, h - shift - 1); y++) {
        const i = (y + shift) * w + x
        profile[y] += strokes[i] | strokes[i + w]
      }
    }
    for (let y = 0; y < h; y++) profile[y] /= ex - sx
    const lines: number[] = []
    for (let y = 0; y < h; y++) {
      if (profile[y] < 0.5) continue
      let e = y
      while (e + 1 < h && profile[e + 1] >= 0.5) e++
      // Thick bands are beams or solid blocks, not staff lines.
      if (e - y + 1 <= maxThick) lines.push((y + e) / 2)
      y = e
    }
    for (let i = 0; i + 4 < lines.length; ) {
      const gaps = [1, 2, 3, 4].map((j) => lines[i + j] - lines[i + j - 1])
      const mean = (lines[i + 4] - lines[i]) / 4
      const even = gaps.every((g) => Math.abs(g - mean) <= Math.max(1.5, mean * 0.2))
      if (even && mean >= MIN_SPACING_MM * mm && mean <= MAX_SPACING_MM * mm) {
        segs.push({ strip: k, x: xc, top: lines[i], spacing: mean })
        i += 5
      } else i++
    }
  }

  // Chain segments strip to strip; a strip may be skipped (clef, dense chords, a gap).
  const chains: Seg[][] = []
  for (const s of segs) {
    let best: Seg[] | null = null
    let bestD = Infinity
    for (const c of chains) {
      const last = c[c.length - 1]
      if (last.strip >= s.strip || s.strip - last.strip > 3) continue
      const d = Math.abs(last.top - s.top)
      if (d < Math.max(last.spacing, s.spacing) * 1.2 && Math.abs(last.spacing - s.spacing) < s.spacing * 0.25 && d < bestD) {
        best = c
        bestD = d
      }
    }
    if (best) best.push(s)
    else chains.push([s])
  }

  const staves: Staff[] = []
  for (const c of chains) {
    if (c.length < 2) continue
    const spacing = c.reduce((a, s) => a + s.spacing, 0) / c.length
    const topAt = (x: number) => interpolate(c, x)
    const [x0, x1] = staffExtent(strokes, w, h, c, spacing, sw, mm, topAt)
    if (x1 - x0 < 25 * mm) continue
    const top = c.reduce((a, s) => a + s.top, 0) / c.length
    staves.push({ x0, x1, top, bottom: top + 4 * spacing, spacing, samples: c.map((s) => ({ x: s.x, top: s.top })) })
  }
  staves.sort((a, b) => a.top - b.top)
  return { staves: dropOverlapping(staves), ink, strokes }
}

interface Seg {
  strip: number
  /** Strip centre. */
  x: number
  top: number
  spacing: number
}

function interpolate(c: Seg[], x: number): number {
  if (x <= c[0].x) return c[0].top
  for (let i = 1; i < c.length; i++) {
    if (x <= c[i].x) {
      const t = (x - c[i - 1].x) / (c[i].x - c[i - 1].x)
      return c[i - 1].top + t * (c[i].top - c[i - 1].top)
    }
  }
  return c[c.length - 1].top
}

/**
 * Left/right end of a staff: columns where at least three of the five lines have stroke
 * pixels (±1px), with short interruptions bridged; the run around the chained strips wins.
 */
function staffExtent(
  strokes: Uint8Array, w: number, h: number, c: Seg[], spacing: number, sw: number, mm: number, topAt: (x: number) => number,
): [number, number] {
  const from = Math.max(0, Math.round(c[0].x - 1.5 * sw))
  const to = Math.min(w, Math.round(c[c.length - 1].x + 1.5 * sw))
  const on = new Uint8Array(to - from)
  for (let x = from; x < to; x++) {
    const t = topAt(x)
    let hits = 0
    for (let j = 0; j < 5; j++) {
      const y = Math.round(t + j * spacing)
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy >= 0 && yy < h && strokes[yy * w + x]) {
          hits++
          break
        }
      }
    }
    on[x - from] = hits >= 3 ? 1 : 0
  }
  const bridge = Math.round(2 * mm)
  const centre = Math.round((c[0].x + c[c.length - 1].x) / 2) - from
  let best: [number, number] = [c[0].x - sw / 2, c[c.length - 1].x + sw / 2]
  let bestScore = -1
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue
    let e = i
    for (let j = i + 1; j < on.length && j - e <= bridge + 1; j++) if (on[j]) e = j
    // Prefer the run that covers the chain; among those the longest.
    const score = (i <= centre && e >= centre ? on.length : 0) + (e - i)
    if (score > bestScore) {
      bestScore = score
      best = [i + from, e + from + 1]
    }
    i = e
  }
  return best
}

/** Two chains can describe the same staff when a strip gap split them; keep the longer one. */
function dropOverlapping(staves: Staff[]): Staff[] {
  const out: Staff[] = []
  for (const s of staves) {
    const o = out.find((t) => Math.abs(t.top - s.top) < s.spacing * 2 && s.x0 < t.x1 && t.x0 < s.x1)
    if (!o) out.push(s)
    else if (s.x1 - s.x0 > o.x1 - o.x0) out[out.indexOf(o)] = s
  }
  return out
}

/**
 * Evidence for which end of the staves the clefs are on. Clefs and key signatures put far
 * more non-staff-line ink right after the staff start than there usually is before its
 * end (a barline, sometimes a courtesy time signature). Each staff votes for the side
 * with clearly more ink; `ratio` is left/right ink over all staves.
 */
export function clefSide(det: StaffDetection, width: number): { left: number; right: number; ratio: number } {
  let left = 0
  let right = 0
  let inkL = 0
  let inkR = 0
  for (const s of det.staves) {
    const H = s.bottom - s.top
    const win = Math.round(1.5 * H)
    const y0 = Math.max(0, Math.round(s.top - s.spacing))
    const y1 = Math.round(s.bottom + s.spacing)
    const count = (a: number, b: number) => {
      let n = 0
      for (let y = y0; y < y1; y++) {
        const row = y * width
        for (let x = Math.max(0, a); x < Math.min(width, b); x++) n += det.ink[row + x] & (det.strokes[row + x] ^ 1)
      }
      return n
    }
    const l = count(Math.round(s.x0), Math.round(s.x0) + win)
    const r = count(Math.round(s.x1) - win, Math.round(s.x1))
    inkL += l
    inkR += r
    if (l > r * 1.3) left++
    else if (r > l * 1.3) right++
  }
  return { left, right, ratio: (inkL + 1) / (inkR + 1) }
}

export interface StaffSpaceEstimate {
  /** Distance between adjacent staff lines (centre to centre) in pixels. */
  spacing: number
  /** Share of all line+gap pairs that agree with `spacing`; low means "no staves here". */
  confidence: number
}

/**
 * Staff-line spacing from run lengths, without knowing the resolution: along every few
 * columns, each black run followed by a white run measures one line + one gap, and on a
 * score the most common such pair is the staff-line spacing (the classic OMR estimate).
 * Rows are measured too and the clearer of the two wins, so sideways pages work.
 * The threshold block is relative to the image size, so this is scale-free.
 */
export function estimateStaffSpace(cv: CV, gray: GrayImage): StaffSpaceEstimate | null {
  const { width: w, height: h } = gray
  const src = new cv.Mat(h, w, cv.CV_8UC1)
  src.data.set(gray.data)
  const bin = new cv.Mat()
  const block = Math.max(15, Math.round(Math.min(w, h) / 40)) | 1
  cv.adaptiveThreshold(src, bin, 1, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, block, 10)
  const ink = bin.data as Uint8Array
  const best = [measure(ink, w, h, true), measure(ink, w, h, false)].sort((a, b) => b.confidence - a.confidence)[0]
  src.delete()
  bin.delete()
  return best.spacing > 0 ? best : null
}

function measure(ink: Uint8Array, w: number, h: number, vertical: boolean): StaffSpaceEstimate {
  const [lines, len, step, stride] = vertical ? [w, h, w, 1] : [h, w, 1, w]
  const max = Math.max(8, Math.round(Math.min(w, h) / 25))
  const pairs = new Float64Array(max + 2)
  let total = 0
  for (let l = 0; l < lines; l += 3) {
    const base = l * stride
    let i = 0
    while (i < len && ink[base + i * step]) i++
    while (i < len) {
      // At a white pixel following black: measure white run, then the next black run.
      let b0 = i
      while (i < len && !ink[base + i * step]) i++
      const white = i - b0
      b0 = i
      while (i < len && ink[base + i * step]) i++
      const black = i - b0
      if (i >= len) break
      const sum = white + black
      // Thin lines only: a black run longer than the gap is a note head, beam or stem end.
      if (black <= white && sum <= max) {
        pairs[sum]++
        total++
      }
    }
  }
  let mode = 0
  for (let s = 3; s <= max; s++) if (pairs[s] + pairs[s - 1] + pairs[s + 1] > pairs[mode] + (mode ? pairs[mode - 1] + pairs[mode + 1] : 0)) mode = s
  if (!mode || !total) return { spacing: 0, confidence: 0 }
  let near = 0
  let weighted = 0
  const tol = Math.max(1, Math.round(mode * 0.15))
  for (let s = mode - tol; s <= mode + tol; s++) {
    near += pairs[s]
    weighted += pairs[s] * s
  }
  return { spacing: weighted / near, confidence: near / total }
}

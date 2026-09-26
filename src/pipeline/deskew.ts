import type { CV } from './types.ts'
import { median } from './image.ts'

export const MAX_SKEW_DEG = 5

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export interface SkewResult {
  /** Correction angle in degrees; positive = rotate counter-clockwise. */
  angle: number
  /** Projection-profile estimate (primary). */
  profileAngle: number
  /** Peak sharpness of the best projection relative to the unrotated one; < ~1.05 means "no lines found". */
  profileGain: number
  /** Length-weighted median of HoughLinesP segment angles (cross-check). */
  houghAngle: number
  /** Segments used for the Hough estimate, in full-image coordinates (for debug overlays). */
  segments: [number, number, number, number][]
}

/**
 * Keeps only horizontal-ish strokes (staff lines, beams, ledger lines) from an ink mask.
 * A horizontal opening removes note heads, stems and text; tilted staff lines survive
 * because at ≤5° each row segment of a 2px-thick line is still ~20px long at 150dpi.
 */
export function horizontalStrokes(cv: CV, ink: Uint8Array, width: number, height: number, dpi: number): Uint8Array {
  const src = new cv.Mat(height, width, cv.CV_8UC1)
  src.data.set(ink)
  const dst = new cv.Mat()
  const len = Math.max(5, Math.round((2.5 / 25.4) * dpi))
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(len, 1))
  cv.morphologyEx(src, dst, cv.MORPH_OPEN, kernel)
  const out = new Uint8Array(dst.data)
  src.delete()
  dst.delete()
  kernel.delete()
  return out
}

/**
 * Estimates the skew of the staff lines inside `region` of a horizontal-stroke mask.
 * Uses the projection-profile method (maximise the sharpness of the row histogram
 * after shearing by tan θ) and reports the HoughLinesP median angle alongside it.
 */
export function detectSkew(cv: CV, strokes: Uint8Array, width: number, region: Region): SkewResult {
  const { x: rx, y: ry, width: rw, height: rh } = region

  // Collect stroke pixels, subsampled to bound the cost.
  let count = 0
  for (let y = ry; y < ry + rh; y++) {
    const row = y * width
    for (let x = rx; x < rx + rw; x++) count += strokes[row + x]
  }
  const step = Math.max(1, Math.ceil(count / 100_000))
  const xs = new Float64Array(Math.ceil(count / step) + 1)
  const ys = new Float64Array(xs.length)
  let n = 0
  let k = 0
  const cx = rx + rw / 2
  for (let y = ry; y < ry + rh; y++) {
    const row = y * width
    for (let x = rx; x < rx + rw; x++) {
      if (!strokes[row + x]) continue
      if (k++ % step) continue
      xs[n] = x - cx
      ys[n] = y - ry
      n++
    }
  }

  const hist = new Float64Array(rh + 2 * Math.ceil(rw * Math.tan((MAX_SKEW_DEG * Math.PI) / 180)) + 4)
  const offset = (hist.length - rh) / 2
  const score = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180)
    hist.fill(0)
    for (let i = 0; i < n; i++) hist[Math.round(ys[i] - xs[i] * t + offset)]++
    let s = 0
    for (let i = 0; i < hist.length; i++) s += hist[i] * hist[i]
    return s
  }

  let best = 0
  let bestScore = -1
  const search = (from: number, to: number, stepDeg: number) => {
    for (let a = from; a <= to + 1e-9; a += stepDeg) {
      const s = score(a)
      if (s > bestScore) {
        bestScore = s
        best = a
      }
    }
  }
  let profileAngle = 0
  let profileGain = 1
  if (n > 100) {
    search(-MAX_SKEW_DEG, MAX_SKEW_DEG, 0.2)
    search(best - 0.2, best + 0.2, 0.02)
    profileAngle = best
    profileGain = bestScore / Math.max(1, score(0))
    // A flat response means there are no dominant horizontal lines (e.g. a title page).
    const flat = bestScore / Math.max(1, Math.min(score(-MAX_SKEW_DEG), score(MAX_SKEW_DEG)))
    if (flat < 1.15) profileAngle = 0
  }

  const { angle: houghAngle, segments } = houghSkew(cv, strokes, width, region)
  return {
    angle: round2(profileAngle),
    profileAngle: round2(profileAngle),
    profileGain,
    houghAngle: round2(houghAngle),
    segments,
  }
}

function houghSkew(cv: CV, strokes: Uint8Array, width: number, r: Region) {
  const src = new cv.Mat(r.height, r.width, cv.CV_8UC1)
  for (let y = 0; y < r.height; y++) {
    const s = (y + r.y) * width + r.x
    src.data.set(strokes.subarray(s, s + r.width), y * r.width)
  }
  const lines = new cv.Mat()
  // Coarse θ bins are enough: the angle is measured from the segment end points.
  cv.HoughLinesP(src, lines, 1, Math.PI / 360, 50, Math.round(r.width * 0.1), 8)
  const angles: number[] = []
  const segments: [number, number, number, number][] = []
  // OpenCV 5 returns lines as a 1×N CV_32SC4 Mat, older builds as N×1; count elements instead.
  for (let i = 0; i < lines.data32S.length / 4; i++) {
    const [x1, y1, x2, y2] = lines.data32S.subarray(i * 4, i * 4 + 4)
    const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
    const a = deg > 90 ? deg - 180 : deg < -90 ? deg + 180 : deg
    if (Math.abs(a) > MAX_SKEW_DEG) continue
    // Weight by length: push one sample per ~20px of segment.
    const reps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 20))
    for (let j = 0; j < reps; j++) angles.push(a)
    segments.push([x1 + r.x, y1 + r.y, x2 + r.x, y2 + r.y])
  }
  src.delete()
  lines.delete()
  return { angle: angles.length ? median(angles) : 0, segments }
}

const round2 = (v: number) => Math.round(v * 100) / 100

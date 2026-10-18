import type { CV, GrayImage, PerspectiveFix } from './types.ts'
import { inkMask } from './image.ts'
import { detectStaves, type Staff } from './staff.ts'

/**
 * Perspective ("keystone") correction for photographed pages.
 *
 * A page photographed with a phone is seen at an angle: its staff lines converge instead of
 * running parallel, and the barlines (which stand square on the staves) lean. Rotation alone
 * cannot fix that. The print itself gives the geometry away, more reliably than the paper
 * edge (hidden by a binder, a plastic sleeve or glare): every staff is a straight line, all
 * of them are parallel on paper, their left and right ends line up, and barlines and stems
 * are perpendicular to them. From these a quadrilateral on the music block is fitted and
 * mapped back to a rectangle whose aspect ratio is recovered from the vanishing geometry
 * (Zhang & He's whiteboard method). The result is a `PerspectiveFix` (types.ts).
 */
/** A horizontal slice of the page the fix is for: a half of a spread, or the whole page. */
export interface Frame {
  x: number
  width: number
}

/** Below this much convergence / shear (degrees) a page counts as flat, as a scan is; nothing is warped then. */
const MIN_DISTORTION_DEG = 0.2
/** Staves disagreeing with the fitted slope model by more than this don't count as evidence. */
const SLOPE_TOLERANCE_DEG = 0.5
/** Staff ends this far off the fitted line still count as aligned (photos blur the first barline). */
const END_TOLERANCE_MM = 3
/** Vertical strokes leaning this much more than the fitted trend are not barlines or stems. */
const LEAN_TOLERANCE_DEG = 1.5

/**
 * Fits the perspective of `frame` of `page` (pixels at `dpi`; the page centre is taken to be
 * the camera's principal point) from the staves found in it. Returns null when there is too
 * little evidence (fewer than four staves, inconsistent slopes, no aligned ends and no
 * upright strokes) or when the page is flat.
 *
 * Two passes: the staves' slopes and ends give a first estimate, the page is straightened
 * with it, and the staves and vertical strokes of that straightened image measure what is
 * left (the ends of a staff are read to a millimetre or two on a photo, which over a page
 * height is nearly a degree of lean; barlines and stems are many and square to the staves).
 */
export function fitPerspective(
  cv: CV, page: GrayImage, staves: Staff[], frame: Frame, dpi: number, log: (why: string) => void = () => {},
): PerspectiveFix | null {
  const { width, height } = page
  const mm = dpi / 25.4
  const first = fitFromStaves(staves, width, mm, log)
  if (!first) return null
  const quadToFix = (quad: [number, number][]): PerspectiveFix | null => {
    const fix = fixFromQuad(quad, width, height, log)
    return fix && distorted(quad, log) ? fix : null
  }
  const fix1 = fixFromQuad(first, width, height, log)
  if (!fix1) return null

  // Residual geometry on the straightened frame.
  const straight = rectify(page, fix1, frame.x, frame.width)
  const lines = staffLines(detectStaves(cv, straight, dpi).staves, frame.width / 2)
  const model = lines.length >= 4 ? robustSlopeModel(lines) : null
  const spacing = median(staves.map((s) => s.spacing))
  const column = {
    x0: Math.min(...staves.map((s) => s.x0)) - frame.x - 2 * mm,
    x1: Math.max(...staves.map((s) => s.x1)) - frame.x + 2 * mm,
  }
  const lean = leanModel(verticalLeans(cv, straight, spacing, dpi, column), frame.width, log)
  if (!model && !lean) return quadToFix(first)

  // The fix's rectangle, as the straightened image shows it: edges with the residual slope
  // and lean, meeting at the corners. Mapped back to the source they are the better quad.
  const px = (p: [number, number]): [number, number] => [p[0] * width, p[1] * height]
  const [tl, tr, br, bl] = rectCorners(fix1).map(px)
  // Residual staff lines are y = a + slope(a)·(x − xm) with a read at the frame's centre column.
  const xm = frame.width / 2
  const ym = (tl[1] + bl[1]) / 2
  const slope = (y: number) => (model ? model.alpha + model.beta * y : 0)
  const tilt = (x: number) => (lean ? lean.gamma + lean.delta * x : 0)
  const corner = (y: number, x: number): [number, number] => {
    const d = tilt(x - frame.x)
    const [px_, py] = meet(y, slope(y), xm, x - frame.x - d * ym, d)
    return [px_ + frame.x, py]
  }
  const seen: [number, number][] = [corner(tl[1], tl[0]), corner(tr[1], tr[0]), corner(br[1], br[0]), corner(bl[1], bl[0])]
  const back = homography(rectCorners(fix1).map(px), fix1.quad.map(px))
  const refined = seen.map((p) => apply(back, p))
  if (refined.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return quadToFix(first)
  return quadToFix(refined)
}

/** First estimate: a quadrilateral from the staves' slopes and their aligned ends. */
function fitFromStaves(staves: Staff[], width: number, mm: number, log: (why: string) => void): [number, number][] | null {
  if (staves.length < 4) return (log(`only ${staves.length} staves`), null)
  const xc = width / 2
  const lines = staffLines(staves, xc)
  if (lines.length < 4) return (log(`only ${lines.length} staff lines fitted`), null)
  const model = robustSlopeModel(lines)
  if (!model) return (log('staff slopes disagree'), null)
  const inliers = lines.filter((l) => Math.abs(l.b - (model.alpha + model.beta * l.a)) <= Math.tan((SLOPE_TOLERANCE_DEG * Math.PI) / 180))
  const slopeAt = (a: number) => model.alpha + model.beta * a

  // Staff ends: the left ends lie on one line, the right ends on another. A first staff may
  // be indented and a staff may be read in pieces, so each line is a median fit that most
  // staves must agree with. Without that, the verticals are provisionally taken square to
  // the staves; the upright strokes refine them afterwards.
  const ends = (side: 'x0' | 'x1') => {
    const pts: [number, number][] = inliers.map((l) => {
      const x = l.staff[side]
      return [x, l.a + l.b * (x - xc)]
    })
    const fit = theilSen(pts.map(([x, y]) => [y, x])) // x as a function of y
    if (!fit) return null
    const on = pts.filter(([x, y]) => Math.abs(x - (fit.c + fit.d * y)) <= END_TOLERANCE_MM * mm).length
    log(`${side}: ${on} of ${pts.length} ends aligned, lean ${deg(fit.d).toFixed(2)}°`)
    return on >= 3 && on >= pts.length * 0.6 ? fit : null
  }
  const top = inliers.reduce((m, l) => (l.a < m.a ? l : m))
  const bottom = inliers.reduce((m, l) => (l.a > m.a ? l : m))
  const bT = slopeAt(top.a)
  const bB = slopeAt(bottom.a)
  // A rotated rectangle has verticals leaning the opposite way to its horizontals' slope.
  const squareLean = -(bT + bB) / 2
  const square = (x: number) => ({ c: x - squareLean * ((top.a + bottom.a) / 2), d: squareLean })
  const left = ends('x0') ?? square(median(inliers.map((l) => l.staff.x0)))
  const right = ends('x1') ?? square(median(inliers.map((l) => l.staff.x1)))
  const quad: [number, number][] = [
    meet(top.a, bT, xc, left.c, left.d),
    meet(top.a, bT, xc, right.c, right.d),
    meet(bottom.a, bB, xc, right.c, right.d),
    meet(bottom.a, bB, xc, left.c, left.d),
  ]
  if (quad.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return (log('no corners'), null)
  return quad
}

/** Whether a quadrilateral (TL, TR, BR, BL) is more than a rotated rectangle: converging or sheared edges. */
function distorted(quad: [number, number][], log: (why: string) => void): boolean {
  const [tl, tr, br, bl] = quad
  const angle = (p: [number, number], q: [number, number]) => (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI
  const top = angle(tl, tr)
  const bottom = angle(bl, br)
  const left = angle(tl, bl)
  const right = angle(tr, br)
  const convergeH = Math.abs(top - bottom)
  const convergeV = Math.abs(left - right)
  const shear = Math.abs((left + right) / 2 - (top + bottom) / 2 - 90)
  log(`convergence ${convergeH.toFixed(2)}° / ${convergeV.toFixed(2)}°, shear ${shear.toFixed(2)}°`)
  if (convergeH < MIN_DISTORTION_DEG && convergeV < MIN_DISTORTION_DEG && shear < MIN_DISTORTION_DEG) return (log('flat'), false)
  return true
}

/** The fix mapping `quad` (page pixels) onto its rectangle, or null when the geometry is implausible. */
function fixFromQuad(quad: [number, number][], width: number, height: number, log: (why: string) => void): PerspectiveFix | null {
  const dist = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1])
  const w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2
  const h = w / rectangleAspect(quad, width / 2, height / 2)
  const cx = quad.reduce((s, p) => s + p[0], 0) / 4
  const cy = quad.reduce((s, p) => s + p[1], 0) / 4
  // Keep the warp tame: a result far from the measured size means the geometry was misread.
  const hMeasured = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2
  log(`quad ${quad.map(([x, y]) => `(${x.toFixed(0)},${y.toFixed(0)})`).join(' ')} → ${w.toFixed(0)}×${h.toFixed(0)} (measured height ${hMeasured.toFixed(0)})`)
  if (!(w > 0 && h > hMeasured * 0.7 && h < hMeasured * 1.4)) return (log('implausible aspect'), null)
  return {
    quad: quad.map(([x, y]) => [x / width, y / height] as [number, number]),
    rect: { x: (cx - w / 2) / width, y: (cy - h / 2) / height, width: w / width, height: h / height },
  }
}

/** Where the line y = a + b·(x − xc) meets the line x = c + d·y. */
function meet(a: number, b: number, xc: number, c: number, d: number): [number, number] {
  const y = (a + b * (c - xc)) / (1 - b * d)
  return [c + d * y, y]
}

const deg = (slope: number) => (Math.atan(slope) * 180) / Math.PI

interface StaffLine {
  /** y at the centre column. */
  a: number
  b: number
  weight: number
  staff: Staff
}

/** Each staff as a line through its samples: slope and height at column `xc`, weighted by the span measured. */
function staffLines(staves: Staff[], xc: number): StaffLine[] {
  return staves.flatMap((s) => {
    const l = fitLine(s.samples.map((q) => [q.x - xc, q.top]))
    return l ? [{ ...l, staff: s }] : []
  })
}

/**
 * On a plane in perspective, lines through one vanishing point have a slope that changes
 * linearly with their height: b = α + β·a. Fitted twice, the second time without the staves
 * (a misdetection, a curled corner) that disagree with the first fit. Null when fewer than
 * four or 60% agree.
 */
function robustSlopeModel(lines: StaffLine[]): { alpha: number; beta: number } | null {
  const first = fitSlopeModel(lines)
  if (!first) return null
  const tol = Math.tan((SLOPE_TOLERANCE_DEG * Math.PI) / 180)
  const inliers = lines.filter((l) => Math.abs(l.b - (first.alpha + first.beta * l.a)) <= tol)
  if (inliers.length < 4 || inliers.length < lines.length * 0.6) return null
  return fitSlopeModel(inliers)
}

/**
 * Width / height of the rectangle whose image is `quad` (TL, TR, BR, BL), for a camera with
 * square pixels and its principal point at (u0, v0): Zhang & He, "Whiteboard scanning and
 * image enhancement" (2004), §4. When the view is (near) affine the focal length is
 * indeterminate and the ratio of the measured edge lengths is used instead.
 */
export function rectangleAspect(quad: [number, number][], u0: number, v0: number): number {
  const m = (p: [number, number]) => [p[0], p[1], 1]
  const [m1, m2, m4, m3] = [m(quad[0]), m(quad[1]), m(quad[2]), m(quad[3])]
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3)
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2)
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]]
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]]
  const plain = Math.hypot(n2[0], n2[1]) / Math.hypot(n3[0], n3[1])
  const zz = n2[2] * n3[2]
  if (Math.abs(zz) < 1e-12) return plain
  const f2 =
    -(n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + zz * u0 * u0 + (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + zz * v0 * v0)) / zz
  const span = Math.max(u0, v0) * 2
  // Phone cameras have a focal length of about one image diagonal; far outside that the
  // estimate is noise (a nearly affine view).
  if (!(f2 > 0) || Math.sqrt(f2) < span * 0.3 || Math.sqrt(f2) > span * 20) return plain
  const norm2 = (n: number[]) => ((n[0] - u0 * n[2]) ** 2 + (n[1] - v0 * n[2]) ** 2) / f2 + n[2] * n[2]
  const r = Math.sqrt(norm2(n2) / norm2(n3))
  return Number.isFinite(r) && r > 0 ? r : plain
}

interface Lean {
  x: number
  y: number
  /** dx/dy of the stroke. */
  d: number
  height: number
}

/**
 * Upright strokes (barlines, stems, brackets) of a page that is already nearly straight, with
 * how much each leans. A short vertical opening (1.5 staff spaces) of the ink removes staff
 * lines, note heads, text and flags and leaves the strokes as candidates; each tall and
 * narrow enough is measured as the line through the centre of each of its rows, read on the
 * ink in a strip just around it, see below. Only strokes within the music `column` count
 * (a paper or binder edge is not on the page's plane, or not upright).
 */
export function verticalLeans(cv: CV, img: GrayImage, spacing: number, dpi: number, column: { x0: number; x1: number }): Lean[] {
  const { width: w, height: h } = img
  const mm = dpi / 25.4
  const ink = inkMask(cv, img, 4 * mm)
  const src = new cv.Mat(h, w, cv.CV_8UC1)
  src.data.set(ink)
  const open = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, Math.max(5, Math.round(1.5 * spacing))))
  cv.morphologyEx(src, open, cv.MORPH_OPEN, kernel)
  const labels = new cv.Mat()
  const stats = new cv.Mat()
  const cents = new cv.Mat()
  const n = cv.connectedComponentsWithStats(open, labels, stats, cents, 8, cv.CV_32S)
  const out: Lean[] = []
  for (let i = 1; i < n; i++) {
    const [bx, by, bw, bh] = stats.data32S.subarray(i * 5, i * 5 + 4)
    if (bh < 3 * spacing || bh > h * 0.8) continue
    if (bw > 0.5 * spacing + bh * 0.06 + 2) continue
    if (bx + bw / 2 < column.x0 || bx + bw / 2 > column.x1) continue
    // Centre of the stroke in every row, read on the ink just around the component (the
    // opening bites the outermost column of a leaning stroke where its run is short, which
    // would pull the lean towards zero). Rows whose ink reaches the edge of that strip
    // belong to something else as well (a staff line, a note head, a neighbour) and are skipped.
    const grow = 1 + Math.ceil(bh * 0.06)
    const xa = Math.max(0, bx - grow)
    const xb = Math.min(w, bx + bw + grow)
    const maxRow = 0.6 * spacing + 2
    let rows = 0
    let sy = 0
    let sx = 0
    let syy = 0
    let sxy = 0
    for (let y = by; y < by + bh; y++) {
      const row = y * w
      if (ink[row + xa] || ink[row + xb - 1]) continue
      let cnt = 0
      let sum = 0
      for (let x = xa + 1; x < xb - 1; x++) {
        if (!ink[row + x]) continue
        cnt++
        sum += x
      }
      if (!cnt || cnt > maxRow) continue
      const cx = sum / cnt
      rows++
      sy += y
      sx += cx
      syy += y * y
      sxy += y * cx
    }
    if (rows < bh * 0.6) continue
    const my = sy / rows
    const mx = sx / rows
    const vy = syy - rows * my * my
    if (vy < 1e-6) continue
    out.push({ x: mx, y: my, d: (sxy - rows * my * mx) / vy, height: bh })
  }
  ;[src, open, kernel, labels, stats, cents].forEach((m) => m.delete())
  return out
}

/**
 * How the lean of upright strokes changes across the page, d = γ + δ·x (lines through one
 * vanishing point far below or above), from many noisy strokes. Medians throughout: a few
 * strokes are not upright at all (a slur's steep part, a clef's spine, a flag left on a
 * stem) and a least-squares fit would follow them. The trend is the median slope over pairs
 * of strokes far enough apart in x to tell it from the noise; with no such pairs only the
 * common lean is used.
 */
export function leanModel(leans: Lean[], width: number, log: (why: string) => void): { gamma: number; delta: number } | null {
  if (leans.length < 6) return (log(`only ${leans.length} upright strokes`), null)
  const fit = (ls: Lean[]) => {
    const slopes: number[] = []
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const dx = ls[j].x - ls[i].x
        if (Math.abs(dx) >= width * 0.25) slopes.push((ls[j].d - ls[i].d) / dx)
      }
    }
    const delta = slopes.length >= 10 ? median(slopes) : 0
    return { gamma: median(ls.map((l) => l.d - delta * l.x)), delta }
  }
  const first = fit(leans)
  const tol = Math.tan((LEAN_TOLERANCE_DEG * Math.PI) / 180)
  const inliers = leans.filter((l) => Math.abs(l.d - (first.gamma + first.delta * l.x)) <= tol)
  if (inliers.length < 6) return (log(`upright strokes disagree: ${inliers.length} of ${leans.length}`), null)
  const m = fit(inliers)
  log(`${inliers.length} upright strokes: lean ${deg(m.gamma).toFixed(2)}° + ${deg(m.delta * width).toFixed(2)}° across`)
  return m
}

/** Least-squares line y = a + b·x through `pts`, with the span the points cover as its weight. */
function fitLine(pts: [number, number][]): { a: number; b: number; weight: number } | null {
  const n = pts.length
  if (n < 2) return null
  let sx = 0
  let sy = 0
  for (const [x, y] of pts) {
    sx += x
    sy += y
  }
  const mx = sx / n
  const my = sy / n
  let sxx = 0
  let sxy = 0
  for (const [x, y] of pts) {
    sxx += (x - mx) * (x - mx)
    sxy += (x - mx) * (y - my)
  }
  if (sxx < 1e-9) return null
  const b = sxy / sxx
  const xs = pts.map((p) => p[0])
  const span = Math.max(...xs) - Math.min(...xs)
  return { a: my - b * mx, b, weight: span * span }
}

/** Weighted least squares of b = α + β·a over the lines. */
function fitSlopeModel(lines: { a: number; b: number; weight: number }[]): { alpha: number; beta: number } | null {
  let sw = 0
  let sa = 0
  let sb = 0
  for (const l of lines) {
    sw += l.weight
    sa += l.weight * l.a
    sb += l.weight * l.b
  }
  if (sw <= 0) return null
  const ma = sa / sw
  const mb = sb / sw
  let saa = 0
  let sab = 0
  for (const l of lines) {
    saa += l.weight * (l.a - ma) * (l.a - ma)
    sab += l.weight * (l.a - ma) * (l.b - mb)
  }
  if (saa < 1e-9) return null
  const beta = sab / saa
  return { alpha: mb - beta * ma, beta }
}

/** Theil–Sen line v = c + d·u through (u, v) points: median of pairwise slopes, median intercept. */
function theilSen(pts: [number, number][]): { c: number; d: number } | null {
  if (pts.length < 3) return null
  const slopes: number[] = []
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const du = pts[j][0] - pts[i][0]
      if (Math.abs(du) > 1e-6) slopes.push((pts[j][1] - pts[i][1]) / du)
    }
  }
  if (!slopes.length) return null
  const d = median(slopes)
  return { c: median(pts.map(([u, v]) => v - d * u)), d }
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Homography (row-major 3×3) taking each `from` point to the matching `to` point, from four
 * correspondences (the usual 8-equation direct linear solve).
 */
export function homography(from: [number, number][], to: [number, number][]): number[] {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]
    const [u, v] = to[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented system.
  for (let col = 0; col < 8; col++) {
    let piv = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    ;[A[col], A[piv]] = [A[piv], A[col]]
    const p = A[col][col]
    if (Math.abs(p) < 1e-12) throw new Error('degenerate quadrilateral')
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = A[r][col] / p
      if (f === 0) continue
      for (let k = col; k < 9; k++) A[r][k] -= f * A[col][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  return [...h, 1]
}

function apply(m: number[], [x, y]: [number, number]): [number, number] {
  const z = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z]
}

/** Corners of the fix's target rectangle (TL, TR, BR, BL), as fractions. */
function rectCorners(fix: PerspectiveFix): [number, number][] {
  const { x, y, width: w, height: h } = fix.rect
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
}

/**
 * The columns `frameX .. frameX + frameWidth` of `page` as they look with the perspective
 * removed: every pixel of the result is read from where the fix maps it back to on the
 * uncorrected page, so content may come in from beyond the frame (nothing is clipped to
 * it beforehand). Outside the page the result is white.
 */
export function rectify(page: GrayImage, fix: PerspectiveFix, frameX: number, frameWidth: number): GrayImage {
  const px = (p: [number, number]): [number, number] => [p[0] * page.width, p[1] * page.height]
  // Corrected → source.
  const inv = homography(rectCorners(fix).map(px), fix.quad.map(px))
  return warpPerspective(page, inv, frameX, 0, frameWidth, page.height)
}

/**
 * Resamples `src` through `m` (corrected → source, row-major 3×3) into an image covering the
 * corrected-space rectangle at (ox, oy) of size w × h. Bilinear; white outside.
 */
export function warpPerspective(src: GrayImage, m: number[], ox: number, oy: number, w: number, h: number): GrayImage {
  const out = new Uint8Array(w * h).fill(255)
  const { width: sw, height: sh, data } = src
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m
  const xMax = sw - 1
  const yMax = sh - 1
  for (let j = 0; j < h; j++) {
    const v = oy + j
    let X = m0 * ox + m1 * v + m2
    let Y = m3 * ox + m4 * v + m5
    let Z = m6 * ox + m7 * v + m8
    const row = j * w
    for (let i = 0; i < w; i++, X += m0, Y += m3, Z += m6) {
      const iz = 1 / Z
      const x = X * iz
      const y = Y * iz
      if (x < 0 || y < 0 || x > xMax || y > yMax) continue
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const fy = y - y0
      const x1 = x0 < xMax ? x0 + 1 : x0
      const y1 = y0 < yMax ? y0 + 1 : y0
      const r0 = y0 * sw
      const r1 = y1 * sw
      const top = data[r0 + x0] * (1 - fx) + data[r0 + x1] * fx
      const bot = data[r1 + x0] * (1 - fx) + data[r1 + x1] * fx
      out[row + i] = (top * (1 - fy) + bot * fy + 0.5) | 0
    }
  }
  return { width: w, height: h, data: out }
}

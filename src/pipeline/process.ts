import type { CV, GlobalSettings, GrayImage, PageAnalysis, PageOverrides, PerspectiveFix, ResolvedPage, Rotation } from './types.ts'
import { A4_MM, MM_PER_INCH } from './types.ts'
import { crop, grayFromMat, inkMask, matFromGray, resizeGray } from './image.ts'
import { detectSplit, type SplitResult } from './split.ts'
import { detectSkew, horizontalStrokes, type SkewResult } from './deskew.ts'
import { crispen, whiten } from './whiten.ts'
import { contentBox, type Box } from './trim.ts'
import { clefSide, detectStaves, estimateStaffSpace, type Staff, type StaffDetection } from './staff.ts'
import { fitPerspective, rectify, type Frame } from './perspective.ts'

/** Resolution the automatic detection runs at. Results are resolution-independent. */
export const ANALYSIS_DPI = 150

/**
 * Staff-line spacing (centre to centre) every page is taken to have, in mm. Typical of
 * printed parts (the samples measure 1.3–1.9mm). It sets the scale all millimetre
 * tolerances are read in and how far `maxUpscale` lets small content grow.
 */
export const NOMINAL_STAFF_SPACING_MM = 1.6

/**
 * How much finer `gray` really is than `dpi` claims, judged by its staves rather than by
 * the page size it came with: that size is guessed for images (a photo, a crop) and can be
 * wrong in PDFs. With the returned factor k, `dpi * k` is the resolution at which the staff
 * spacing measures NOMINAL_STAFF_SPACING_MM. Returns 1 when no clear staves are found
 * (title pages, text), so those keep the page-size guess.
 */
export function staffDpiScale(cv: CV, gray: GrayImage, dpi: number): number {
  const e = estimateStaffSpace(cv, gray)
  if (!e || e.confidence < 0.5) return 1
  const k = e.spacing / ((NOMINAL_STAFF_SPACING_MM / MM_PER_INCH) * dpi)
  return k >= 0.2 && k <= 5 ? k : 1
}

export interface AnalysisDebug {
  /** The page as analysed, i.e. after `rotation` and with any perspective removed (the page the skews were measured on). */
  gray: GrayImage
  split: SplitResult | null
  halves: SkewResult[]
  whole: SkewResult
}

/**
 * Detects orientation, spread split position and skew. `gray` should be rendered at
 * ANALYSIS_DPI (other resolutions work, `dpi` only scales the tolerances).
 * Pass `rotation` to skip the orientation detection and analyse the page turned that way.
 * `dpiScale` is only recorded in the result (see `staffDpiScale`); `dpi` must already be real.
 */
export function analyzePage(
  cv: CV, source: GrayImage, dpi = ANALYSIS_DPI, rotation?: Rotation, dpiScale = 1,
): { analysis: PageAnalysis; debug: AnalysisDebug } {
  const views = new Map<Rotation, PageView>()
  const view = (r: Rotation) => views.get(r) ?? views.set(r, pageView(cv, rotateQuarter(cv, source, r), dpi)).get(r)!
  const autoRotation = detectOrientation(cv, source, dpi, view)
  const rot = rotation ?? autoRotation
  const v = view(rot)
  const { gray, ink } = v
  const { width: w, height: h } = gray
  // Landscape alone is not enough: a wide crop of a few systems is landscape too, and its
  // staves run straight through the middle where a spread has its gutter.
  const isSpread = w / h > 1.15 && !v.staves.staves.some((s) => s.x0 < w * 0.4 && s.x1 > w * 0.6)
  const split = isSpread ? detectSplit(gray, ink, dpi) : null
  const frames = partFrames(w, split?.x)
  // A photographed page (or each page of a photographed spread, which lie in different
  // planes) is seen in perspective; the staves of each part give its correction. The skew is
  // then measured on the straightened page, as the rest of the pipeline sees it.
  const perspective = frames.map((f) => fitPerspective(cv, gray, stavesIn(v.staves.staves, f), f, dpi))
  const straight = perspective.some(Boolean) ? straighten(gray, frames, perspective) : gray
  const strokes = straight === gray ? v.strokes : pageView(cv, straight, dpi).strokes
  // Skip a strip around the gutter and the page edges: shadows and scan borders are not staff lines.
  const pad = Math.round(w * 0.02)
  const top = Math.round(h * 0.02)
  const rh = h - 2 * top
  const whole = detectSkew(cv, strokes, w, { x: pad, y: top, width: w - 2 * pad, height: rh })
  const halves: SkewResult[] = []
  if (split) {
    const sx = Math.round(split.x * w)
    halves.push(detectSkew(cv, strokes, w, { x: pad, y: top, width: sx - 2 * pad, height: rh }))
    halves.push(detectSkew(cv, strokes, w, { x: sx + pad, y: top, width: w - sx - 2 * pad, height: rh }))
  }
  return {
    analysis: {
      rotation: rot,
      autoRotation,
      dpiScale,
      isSpread,
      splitX: split?.x ?? 0.5,
      splitMethod: split?.method ?? 'center',
      angles: split ? halves.map((r) => r.angle) : [whole.angle],
      wholeAngle: whole.angle,
      perspective,
    },
    debug: { gray: straight, split, halves, whole },
  }
}

/** The column ranges of a page's output parts: both halves of a spread split at `splitX`, or the whole page. */
function partFrames(width: number, splitX?: number): Frame[] {
  if (splitX === undefined) return [{ x: 0, width }]
  const sx = Math.round(splitX * width)
  return [{ x: 0, width: sx }, { x: sx, width: width - sx }]
}

function stavesIn(staves: Staff[], f: Frame): Staff[] {
  return staves.filter((s) => {
    const c = (s.x0 + s.x1) / 2
    return c >= f.x && c < f.x + f.width
  })
}

/** The page with each part's columns replaced by their perspective-corrected content. */
function straighten(gray: GrayImage, frames: Frame[], perspective: (PerspectiveFix | null)[]): GrayImage {
  const out = { width: gray.width, height: gray.height, data: new Uint8Array(gray.data) }
  frames.forEach((f, i) => {
    const fix = perspective[i]
    if (!fix) return
    const part = rectify(gray, fix, f.x, f.width)
    for (let y = 0; y < gray.height; y++) out.data.set(part.data.subarray(y * f.width, (y + 1) * f.width), y * gray.width + f.x)
  })
  return out
}

/**
 * Upright orientation of a page, as a clockwise quarter turn.
 *
 * Staff lines dominate the long straight strokes of a score, so a page whose vertical
 * strokes far outnumber its horizontal ones is lying on its side. Which way up it goes is
 * decided by the clefs: they sit at the start (left end) of every staff. A page whose
 * staves already run horizontally is only turned upside down when most staves clearly
 * have their clef ink on the right, since a wrong flip is far worse than a missed one.
 */
export function detectOrientation(
  cv: CV, gray: GrayImage, dpi: number, view: (r: Rotation) => PageView = (r) => pageView(cv, rotateQuarter(cv, gray, r), dpi),
): Rotation {
  const strokeCount = (v: PageView) => v.strokes.reduce((a, s) => a + s, 0)
  const up = view(0)
  const cw = view(90)
  if (strokeCount(up) >= 0.5 * strokeCount(cw)) {
    const c = clefSide(up.staves, up.gray.width)
    const flipped = c.right >= 3 && c.right >= 3 * c.left && c.ratio < 1 / 1.5
    return flipped ? 180 : 0
  }
  const a = clefSide(cw.staves, cw.gray.width)
  const ccw = view(270)
  const b = clefSide(ccw.staves, ccw.gray.width)
  const va = a.left - a.right
  const vb = b.left - b.right
  return vb > va || (vb === va && b.ratio > a.ratio) ? 270 : 90
}

/**
 * A page turned one way, with the masks and staves the detection steps share. Each is
 * computed on first use and then reused, so orientation, spread and skew detection
 * don't repeat the same work on the same image.
 */
export interface PageView {
  gray: GrayImage
  readonly ink: Uint8Array
  readonly strokes: Uint8Array
  readonly staves: StaffDetection
}

function pageView(cv: CV, gray: GrayImage, dpi: number): PageView {
  let ink: Uint8Array | undefined
  let strokes: Uint8Array | undefined
  let staves: StaffDetection | undefined
  return {
    gray,
    get ink() {
      return (ink ??= inkMask(cv, gray, (4 / MM_PER_INCH) * dpi))
    },
    get strokes() {
      return (strokes ??= horizontalStrokes(cv, this.ink, gray.width, gray.height, dpi))
    },
    get staves() {
      return (staves ??= detectStaves(cv, gray, dpi, { ink: this.ink, strokes: this.strokes }))
    },
  }
}

/** Lossless clockwise rotation by a multiple of 90°. */
export function rotateQuarter(cv: CV, img: GrayImage, r: Rotation): GrayImage {
  if (r === 0) return img
  const src = matFromGray(cv, img)
  const dst = new cv.Mat()
  cv.rotate(src, dst, r === 90 ? cv.ROTATE_90_CLOCKWISE : r === 180 ? cv.ROTATE_180 : cv.ROTATE_90_COUNTERCLOCKWISE)
  const out = grayFromMat(dst)
  src.delete()
  dst.delete()
  return out
}

export function resolvePage(a: PageAnalysis, g: GlobalSettings, o: PageOverrides = {}): ResolvedPage {
  const split = o.split ?? a.isSpread
  const auto = split ? (a.angles.length === 2 ? a.angles : [a.wholeAngle, a.wholeAngle]) : [a.wholeAngle]
  // The fixes are in page coordinates, so a whole-page fix serves both halves when the user
  // splits a page; two per-half fixes can't serve a page the user joins (different planes).
  const fixes = a.perspective
  const perspective = !g.perspective ? [] : split === a.isSpread ? fixes : split ? [fixes[0] ?? null, fixes[0] ?? null] : []
  return {
    bypass: o.bypass ?? false,
    rotation: a.rotation,
    dpiScale: a.dpiScale,
    split,
    splitX: o.splitX ?? a.splitX,
    angles: auto.map((v, i) => o.angles?.[i] ?? v),
    perspective,
    whiten: g.whiten,
    trim: g.trim,
    marginMm: g.marginMm,
    vAlign: g.vAlign,
    maxUpscale: g.maxUpscale,
  }
}

/** Whether the page's sheets are pure black and white (exported at 1 bit per pixel). An untouched page keeps its tones. */
export function isBilevel(p: ResolvedPage): boolean {
  return !p.bypass && p.whiten.enabled && p.whiten.mode === 'adaptive'
}

export interface RenderedSheet {
  /** A4 portrait page at `outDpi`. */
  image: GrayImage
  /** Content box in the corrected (rotated) part image at the source resolution; for debugging. */
  content: Box | null
  /** Staves found for trimming, in the same coordinates as `content`; for debugging. */
  staves: Staff[]
}

/** Trimming only needs a coarse image; staves are found on a copy at this resolution. */
const TRIM_DPI = 150

export interface RenderOptions {
  /**
   * Black-and-white pages: always resample the grey page and threshold last, whatever the
   * scale (see THRESHOLD_AFTER_ENLARGING). Slower; for a preview that is shown reduced.
   */
  smooth?: boolean
}

/**
 * Enlargement (output pixels per source pixel) from which a black-and-white page is
 * thresholded after the resampling rather than before, see `renderPage`; below 1:1 it
 * always is. A 300dpi scan exported at 600dpi stays on the fast path; photos and
 * 150–200dpi scans don't.
 */
const THRESHOLD_AFTER_ENLARGING = 2.5

/**
 * Applies the corrections to a source page rendered at `dpi` and lays each resulting
 * part out on an A4 portrait page at `outDpi`.
 *
 * To preserve quality the pixels are resampled exactly once: rotation, scaling and
 * placement are combined into a single affine warp of the (whitened) source.
 */
export function renderPage(cv: CV, gray: GrayImage, dpi: number, p: ResolvedPage, outDpi: number, opts: RenderOptions = {}): RenderedSheet[] {
  if (p.bypass) {
    return [{ image: layout(cv, gray, 0, null, dpi, outDpi, p.marginMm, 'center', Infinity), content: null, staves: [] }]
  }
  gray = rotateQuarter(cv, gray, p.rotation)
  // Each part straightened (a photographed page) or cut out as it is.
  const parts = partFrames(gray.width, p.split ? p.splitX : undefined).map((f, i) => {
    const fix = p.perspective[i]
    return fix ? rectify(gray, fix, f.x, f.width) : crop(gray, f.x, 0, f.width, gray.height)
  })
  const sheets: RenderedSheet[] = []
  parts.forEach((part, i) => {
    const img = whiten(cv, part, p.whiten, dpi)
    const angle = p.angles[i] ?? 0
    let box: Box | null = null
    let staves: Staff[] = []
    if (p.trim) {
      const s = Math.min(1, TRIM_DPI / dpi)
      const small = rotate(cv, resizeGray(cv, img, s), angle, true)
      staves = detectStaves(cv, small, dpi * s).staves
      // The unwhitened page tells paper from what lies around it on a photo.
      const paper = p.whiten.enabled ? rotate(cv, resizeGray(cv, part, s), angle, true) : small
      const b = contentBox(cv, small, dpi * s, staves, paper)
      box = b && { x: b.x / s, y: b.y / s, width: b.width / s, height: b.height / s }
      staves = staves.map((t) => ({
        ...t, x0: t.x0 / s, x1: t.x1 / s, top: t.top / s, bottom: t.bottom / s, spacing: t.spacing / s,
        samples: t.samples.map((q) => ({ x: q.x / s, top: q.top / s })),
      }))
    }
    // One side of a spread left blank (the back of a cover, an empty last page): no sheet for it.
    if (p.trim && p.split && !box) return
    let image: GrayImage
    if (!isBilevel(p)) {
      image = layout(cv, img, angle, box, dpi, outDpi, p.marginMm, p.vAlign, p.maxUpscale, cv.INTER_CUBIC)
      // After the one resampling step, so edges are sharpened at the output resolution.
      if (p.whiten.enabled && p.whiten.mode === 'levels' && p.whiten.sharpen) crispen(image)
    } else {
      const m = layoutScale(img, angle, box, dpi, outDpi, p.marginMm, p.maxUpscale)
      if (!opts.smooth && m >= 1 && m <= THRESHOLD_AFTER_ENLARGING) {
        // About 1:1 (a scan at the export resolution): already pure black and white and
        // thresholded again when packed to 1 bit, so interpolation would only move edges by a
        // fraction of a pixel. Nearest is ~6x faster than cubic in OpenCV.js.
        image = layout(cv, img, angle, box, dpi, outDpi, p.marginMm, p.vAlign, p.maxUpscale, cv.INTER_NEAREST)
      } else {
        // Enlarged a lot (a photo, a 150dpi scan) or reduced (the preview): thresholding first
        // and resampling the result magnifies every pixel step of its edges, or aliases its
        // thin lines into dashes. Resample the grey page instead and threshold at the output
        // resolution, where an edge follows the smooth contour of the interpolated image and
        // a thin line is a shallow but continuous valley. Nothing is blurred, so small glyphs
        // keep their counters.
        // Thresholded before the surroundings are painted white: next to pure white, the
        // paper itself would fall under the local mean and come out as a dark frame.
        image = layout(cv, part, angle, box, dpi, outDpi, p.marginMm, p.vAlign, p.maxUpscale, cv.INTER_CUBIC, (o) => whiten(cv, o, p.whiten, outDpi))
      }
    }
    sheets.push({ image, content: box, staves })
  })
  return sheets
}

/** Canvas size of `img` rotated by `deg` with nothing clipped. */
function rotatedSize(img: GrayImage, deg: number) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return { width: Math.ceil(img.width * cos + img.height * sin), height: Math.ceil(img.width * sin + img.height * cos) }
}

/** 2x3 affine matrix (row-major) rotating `img` counter-clockwise by `deg` into its expanded canvas. */
function rotationMatrix(img: GrayImage, deg: number): number[] {
  const rad = (deg * Math.PI) / 180
  const a = Math.cos(rad)
  const b = Math.sin(rad)
  const { width, height } = rotatedSize(img, deg)
  const cx = img.width / 2
  const cy = img.height / 2
  // Same convention as cv.getRotationMatrix2D (positive = counter-clockwise on screen),
  // then shifted so the rotated image is centred in the expanded canvas.
  return [a, b, (1 - a) * cx - b * cy + (width - img.width) / 2, -b, a, b * cx + (1 - a) * cy + (height - img.height) / 2]
}

/** Rotates counter-clockwise by `deg` with a white fill, growing the canvas when `expand`. */
export function rotate(cv: CV, img: GrayImage, deg: number, expand: boolean): GrayImage {
  if (Math.abs(deg) < 0.01) return img
  const size = expand ? rotatedSize(img, deg) : { width: img.width, height: img.height }
  const m = rotationMatrix(img, deg)
  if (!expand) {
    m[2] -= (rotatedSize(img, deg).width - img.width) / 2
    m[5] -= (rotatedSize(img, deg).height - img.height) / 2
  }
  return warp(cv, img, m, size.width, size.height, cv.INTER_LINEAR)
}

function warp(cv: CV, img: GrayImage, m: number[], w: number, h: number, interp: number): GrayImage {
  const src = matFromGray(cv, img)
  const mat = cv.matFromArray(2, 3, cv.CV_64F, m)
  const dst = new cv.Mat()
  cv.warpAffine(src, dst, mat, new cv.Size(w, h), interp, cv.BORDER_CONSTANT, new cv.Scalar(255))
  const out = grayFromMat(dst)
  src.delete()
  dst.delete()
  mat.delete()
  return out
}

/** The A4 page in output pixels, its margin, the box being placed and the scale it gets (see `layout`). */
function fitOnA4(img: GrayImage, deg: number, box: Box | null, dpi: number, outDpi: number, marginMm: number, maxUpscale: number) {
  const rs = Math.abs(deg) < 0.01 ? { width: img.width, height: img.height } : rotatedSize(img, deg)
  const b = box ?? { x: 0, y: 0, width: rs.width, height: rs.height }
  const pxPerMm = outDpi / MM_PER_INCH
  const W = Math.round(A4_MM.width * pxPerMm)
  const H = Math.round(A4_MM.height * pxPerMm)
  const m = Math.round(marginMm * pxPerMm)
  const fit = Math.min((W - 2 * m) / b.width, (H - 2 * m) / b.height)
  return { box: b, W, H, m, scale: Math.min(fit, maxUpscale * (outDpi / dpi)) }
}

/** Output pixels per source pixel that `layout` would use for this content. */
export function layoutScale(img: GrayImage, deg: number, box: Box | null, dpi: number, outDpi: number, marginMm: number, maxUpscale: number): number {
  return fitOnA4(img, deg, box, dpi, outDpi, marginMm, maxUpscale).scale
}

/**
 * Rotates `img` by `deg`, takes `box` (in rotated coordinates; whole rotated image when null)
 * and scales it into the A4 area inside `marginMm`, centred horizontally — all in one warp.
 * Anything outside `box` is left white. `finish` runs on the placed page before that
 * (whitening that must not see the painted surroundings).
 * Content is never enlarged past `maxUpscale` × its original physical size, so a
 * half-empty last page keeps the same staff size as the others.
 */
export function layout(
  cv: CV,
  img: GrayImage,
  deg: number,
  box: Box | null,
  dpi: number,
  outDpi: number,
  marginMm: number,
  vAlign: 'top' | 'center',
  maxUpscale: number,
  interp: number = cv.INTER_CUBIC,
  finish?: (placed: GrayImage) => GrayImage,
): GrayImage {
  const rot = Math.abs(deg) < 0.01 ? [1, 0, 0, 0, 1, 0] : rotationMatrix(img, deg)
  const { box: b, scale, W, H, m } = fitOnA4(img, deg, box, dpi, outDpi, marginMm, maxUpscale)
  const dw = b.width * scale
  const dh = b.height * scale
  const dx = (W - dw) / 2
  const dy = vAlign === 'top' ? m : (H - dh) / 2

  // out = scale * (rot(p) - box.xy) + (dx, dy)
  const M = [
    scale * rot[0], scale * rot[1], scale * (rot[2] - b.x) + dx,
    scale * rot[3], scale * rot[4], scale * (rot[5] - b.y) + dy,
  ]
  // Cubic keeps note heads and thin staff lines crisp; for strong reductions pre-shrink with
  // area averaging first to avoid aliasing (only happens for oversized sources).
  let out: GrayImage
  if (scale < 0.5) {
    const pre = resizeGray(cv, img, scale * 2)
    const k = 1 / (scale * 2)
    out = warp(cv, pre, [M[0] * k, M[1] * k, M[2], M[3] * k, M[4] * k, M[5]], W, H, interp)
  } else {
    out = warp(cv, img, M, W, H, interp)
  }
  if (finish) out = finish(out)
  // Whatever lies outside the trimmed box (the other page, stamps in the margin) would
  // otherwise show through in the margins.
  if (box) whiteOutside(out, dx, dy, dw, dh, Math.round(outDpi / MM_PER_INCH))
  return out
}

/** Paints everything outside the rectangle (grown by `pad`) white, in place. */
function whiteOutside(img: GrayImage, x: number, y: number, w: number, h: number, pad: number) {
  const x0 = Math.max(0, Math.floor(x - pad))
  const y0 = Math.max(0, Math.floor(y - pad))
  const x1 = Math.min(img.width, Math.ceil(x + w + pad))
  const y1 = Math.min(img.height, Math.ceil(y + h + pad))
  for (let r = 0; r < img.height; r++) {
    const row = r * img.width
    if (r < y0 || r >= y1) {
      img.data.fill(255, row, row + img.width)
    } else {
      img.data.fill(255, row, row + x0)
      img.data.fill(255, row + x1, row + img.width)
    }
  }
}

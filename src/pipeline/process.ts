import type { CV, GlobalSettings, GrayImage, PageAnalysis, PageOverrides, ResolvedPage } from './types.ts'
import { A4_MM, MM_PER_INCH } from './types.ts'
import { crop, grayFromMat, inkMask, matFromGray, resizeGray } from './image.ts'
import { detectSplit, type SplitResult } from './split.ts'
import { detectSkew, horizontalStrokes, type SkewResult } from './deskew.ts'
import { whiten } from './whiten.ts'
import { contentBox, type Box } from './trim.ts'

/** Resolution the automatic detection runs at. Results are resolution-independent. */
export const ANALYSIS_DPI = 150

export interface AnalysisDebug {
  split: SplitResult | null
  halves: SkewResult[]
  whole: SkewResult
}

/**
 * Detects spread split position and skew. `gray` should be rendered at ANALYSIS_DPI
 * (other resolutions work, `dpi` only scales the tolerances).
 */
export function analyzePage(cv: CV, gray: GrayImage, dpi = ANALYSIS_DPI): { analysis: PageAnalysis; debug: AnalysisDebug } {
  const { width: w, height: h } = gray
  const ink = inkMask(cv, gray, (4 / MM_PER_INCH) * dpi)
  const isSpread = w / h > 1.15
  const split = isSpread ? detectSplit(gray, ink, dpi) : null
  const strokes = horizontalStrokes(cv, ink, w, h, dpi)
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
      isSpread,
      splitX: split?.x ?? 0.5,
      splitMethod: split?.method ?? 'center',
      angles: split ? halves.map((r) => r.angle) : [whole.angle],
      wholeAngle: whole.angle,
    },
    debug: { split, halves, whole },
  }
}

export function resolvePage(a: PageAnalysis, g: GlobalSettings, o: PageOverrides = {}): ResolvedPage {
  const split = o.split ?? a.isSpread
  const auto = split ? (a.angles.length === 2 ? a.angles : [a.wholeAngle, a.wholeAngle]) : [a.wholeAngle]
  return {
    bypass: o.bypass ?? false,
    split,
    splitX: o.splitX ?? a.splitX,
    angles: auto.map((v, i) => o.angles?.[i] ?? v),
    whiten: g.whiten,
    trim: g.trim,
    marginMm: g.marginMm,
    vAlign: g.vAlign,
    maxUpscale: g.maxUpscale,
  }
}

export interface RenderedSheet {
  /** A4 portrait page at `outDpi`. */
  image: GrayImage
  /** Content box in the corrected (rotated) part image at the source resolution; for debugging. */
  content: Box | null
}

/** Trimming only needs a coarse image; detect the content box on a copy at this resolution. */
const TRIM_DPI = 75

/**
 * Applies the corrections to a source page rendered at `dpi` and lays each resulting
 * part out on an A4 portrait page at `outDpi`.
 *
 * To preserve quality the pixels are resampled exactly once: rotation, scaling and
 * placement are combined into a single affine warp of the (whitened) source.
 */
export function renderPage(cv: CV, gray: GrayImage, dpi: number, p: ResolvedPage, outDpi: number): RenderedSheet[] {
  if (p.bypass) {
    return [{ image: layout(cv, gray, 0, null, dpi, outDpi, p.marginMm, 'center', Infinity), content: null }]
  }
  const parts: GrayImage[] = []
  if (p.split) {
    const sx = Math.round(p.splitX * gray.width)
    parts.push(crop(gray, 0, 0, sx, gray.height), crop(gray, sx, 0, gray.width - sx, gray.height))
  } else {
    parts.push(gray)
  }
  return parts.map((part, i) => {
    const img = whiten(cv, part, p.whiten, dpi)
    const angle = p.angles[i] ?? 0
    let box: Box | null = null
    if (p.trim) {
      const s = Math.min(1, TRIM_DPI / dpi)
      const small = rotate(cv, resizeGray(cv, img, s), angle, true)
      const b = contentBox(cv, small, dpi * s)
      box = b && { x: b.x / s, y: b.y / s, width: b.width / s, height: b.height / s }
    }
    return { image: layout(cv, img, angle, box, dpi, outDpi, p.marginMm, p.vAlign, p.maxUpscale), content: box }
  })
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

/**
 * Rotates `img` by `deg`, takes `box` (in rotated coordinates; whole rotated image when null)
 * and scales it into the A4 area inside `marginMm`, centred horizontally — all in one warp.
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
): GrayImage {
  const rot = Math.abs(deg) < 0.01 ? [1, 0, 0, 0, 1, 0] : rotationMatrix(img, deg)
  const rs = Math.abs(deg) < 0.01 ? { width: img.width, height: img.height } : rotatedSize(img, deg)
  const b = box ?? { x: 0, y: 0, width: rs.width, height: rs.height }

  const pxPerMm = outDpi / MM_PER_INCH
  const W = Math.round(A4_MM.width * pxPerMm)
  const H = Math.round(A4_MM.height * pxPerMm)
  const m = Math.round(marginMm * pxPerMm)
  const fit = Math.min((W - 2 * m) / b.width, (H - 2 * m) / b.height)
  const scale = Math.min(fit, maxUpscale * (outDpi / dpi))
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
  if (scale < 0.5) {
    const pre = resizeGray(cv, img, scale * 2)
    const k = 1 / (scale * 2)
    return warp(cv, pre, [M[0] * k, M[1] * k, M[2], M[3] * k, M[4] * k, M[5]], W, H, cv.INTER_CUBIC)
  }
  return warp(cv, img, M, W, H, cv.INTER_CUBIC)
}

import type { CV, GlobalSettings, GrayImage, PageAnalysis, PageOverrides, ResolvedPage, Rotation } from './types.ts'
import { A4_MM, MM_PER_INCH } from './types.ts'
import { crop, grayFromMat, inkMask, matFromGray, resizeGray } from './image.ts'
import { detectSplit, type SplitResult } from './split.ts'
import { detectSkew, horizontalStrokes, type SkewResult } from './deskew.ts'
import { whiten } from './whiten.ts'
import { contentBox, type Box } from './trim.ts'
import { clefSide, detectStaves, type Staff } from './staff.ts'

/** Resolution the automatic detection runs at. Results are resolution-independent. */
export const ANALYSIS_DPI = 150

export interface AnalysisDebug {
  /** The page as analysed, i.e. after `rotation`. */
  gray: GrayImage
  split: SplitResult | null
  halves: SkewResult[]
  whole: SkewResult
}

/**
 * Detects orientation, spread split position and skew. `gray` should be rendered at
 * ANALYSIS_DPI (other resolutions work, `dpi` only scales the tolerances).
 * Pass `rotation` to skip the orientation detection and analyse the page turned that way.
 */
export function analyzePage(
  cv: CV, source: GrayImage, dpi = ANALYSIS_DPI, rotation?: Rotation,
): { analysis: PageAnalysis; debug: AnalysisDebug } {
  const autoRotation = detectOrientation(cv, source, dpi)
  const rot = rotation ?? autoRotation
  const gray = rotateQuarter(cv, source, rot)
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
      rotation: rot,
      autoRotation,
      isSpread,
      splitX: split?.x ?? 0.5,
      splitMethod: split?.method ?? 'center',
      angles: split ? halves.map((r) => r.angle) : [whole.angle],
      wholeAngle: whole.angle,
    },
    debug: { gray, split, halves, whole },
  }
}

/**
 * Upright orientation of a page, as a clockwise quarter turn.
 *
 * Staff lines dominate the long straight strokes of a score, so a page whose vertical
 * strokes far outnumber its horizontal ones is lying on its side. Which way up it goes is
 * decided by the clefs: they sit at the start (left end) of every staff. A page whose
 * staves already run horizontally is only turned upside down when the clefs clearly sit
 * on the right, since a wrong flip is far worse than a missed one.
 */
export function detectOrientation(cv: CV, gray: GrayImage, dpi: number): Rotation {
  const strokeCount = (g: GrayImage) => {
    const ink = inkMask(cv, g, (4 / MM_PER_INCH) * dpi)
    return horizontalStrokes(cv, ink, g.width, g.height, dpi).reduce((a, v) => a + v, 0)
  }
  const cw = rotateQuarter(cv, gray, 90)
  if (strokeCount(gray) >= 0.5 * strokeCount(cw)) {
    const up = detectStaves(cv, gray, dpi)
    const c = clefSide(up, gray.width)
    return up.staves.length >= 3 && c.ratio < 1 / 1.5 ? 180 : 0
  }
  const a = clefSide(detectStaves(cv, cw, dpi), cw.width)
  const ccw = rotateQuarter(cv, gray, 270)
  const b = clefSide(detectStaves(cv, ccw, dpi), ccw.width)
  return b.ratio > a.ratio ? 270 : 90
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
  return {
    bypass: o.bypass ?? false,
    rotation: a.rotation,
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
  /** Staves found for trimming, in the same coordinates as `content`; for debugging. */
  staves: Staff[]
}

/** Trimming only needs a coarse image; staves are found on a copy at this resolution. */
const TRIM_DPI = 150

/**
 * Applies the corrections to a source page rendered at `dpi` and lays each resulting
 * part out on an A4 portrait page at `outDpi`.
 *
 * To preserve quality the pixels are resampled exactly once: rotation, scaling and
 * placement are combined into a single affine warp of the (whitened) source.
 */
export function renderPage(cv: CV, gray: GrayImage, dpi: number, p: ResolvedPage, outDpi: number): RenderedSheet[] {
  if (p.bypass) {
    return [{ image: layout(cv, gray, 0, null, dpi, outDpi, p.marginMm, 'center', Infinity), content: null, staves: [] }]
  }
  gray = rotateQuarter(cv, gray, p.rotation)
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
    let staves: Staff[] = []
    if (p.trim) {
      const s = Math.min(1, TRIM_DPI / dpi)
      const small = rotate(cv, resizeGray(cv, img, s), angle, true)
      staves = detectStaves(cv, small, dpi * s).staves
      const b = contentBox(cv, small, dpi * s, staves)
      box = b && { x: b.x / s, y: b.y / s, width: b.width / s, height: b.height / s }
      staves = staves.map((t) => ({
        ...t, x0: t.x0 / s, x1: t.x1 / s, top: t.top / s, bottom: t.bottom / s, spacing: t.spacing / s,
        samples: t.samples.map((q) => ({ x: q.x / s, top: q.top / s })),
      }))
    }
    return { image: layout(cv, img, angle, box, dpi, outDpi, p.marginMm, p.vAlign, p.maxUpscale), content: box, staves }
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
 * Anything outside `box` is left white.
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
  let out: GrayImage
  if (scale < 0.5) {
    const pre = resizeGray(cv, img, scale * 2)
    const k = 1 / (scale * 2)
    out = warp(cv, pre, [M[0] * k, M[1] * k, M[2], M[3] * k, M[4] * k, M[5]], W, H, cv.INTER_CUBIC)
  } else {
    out = warp(cv, img, M, W, H, cv.INTER_CUBIC)
  }
  // Whatever lies outside the trimmed box (the other page, stamps in the margin) would
  // otherwise show through in the margins.
  if (box) whiteOutside(out, dx, dy, dw, dh, Math.round(pxPerMm))
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

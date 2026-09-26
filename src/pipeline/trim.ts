import type { CV, GrayImage } from './types.ts'
import { matFromGray } from './image.ts'
import type { Staff } from './staff.ts'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Bounding box of the printed content.
 *
 * Works on a ~50dpi copy: ink is found by adaptive threshold, dilated (~2mm) so that
 * notes and text merge into blobs, then components are filtered:
 * - dust: blobs smaller than ~6x6mm are ignored
 * - scanner edges: thin, long blobs hugging the image border are ignored, and so are
 *   bare lines or line frames spanning half the page anywhere (paper edges, binding)
 *
 * With `staves` (same coordinates as `img`) the music itself anchors the box and other
 * blobs only join when they belong to it, see `keepBlob`. Without staves (title pages,
 * text) every remaining blob counts. Returns null when nothing remains (blank page).
 */
export function contentBox(cv: CV, img: GrayImage, dpi: number, staves: Staff[] = []): Box | null {
  const workDpi = 50
  const s = Math.min(1, workDpi / dpi)
  const mm = (dpi * s) / 25.4
  const src = matFromGray(cv, img)
  const small = new cv.Mat()
  cv.resize(src, small, new cv.Size(Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s))), 0, 0, cv.INTER_AREA)
  const bin = new cv.Mat()
  cv.adaptiveThreshold(small, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, Math.round(8 * mm) | 1, 20)
  // Pixels that are plainly paper can't be ink, however the local contrast looks.
  const paper = new cv.Mat()
  cv.threshold(small, paper, 200, 255, cv.THRESH_BINARY_INV)
  cv.bitwise_and(bin, paper, bin)
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(1, Math.round(2 * mm)), Math.max(1, Math.round(2 * mm))))
  cv.dilate(bin, bin, k)

  const labels = new cv.Mat()
  const stats = new cv.Mat()
  const cents = new cv.Mat()
  const n = cv.connectedComponentsWithStats(bin, labels, stats, cents, 8, cv.CV_32S)
  const W = bin.cols
  const H = bin.rows
  const edge = Math.max(1, Math.round(1.5 * mm))
  const blobs: Blob[] = []
  for (let i = 1; i < n; i++) {
    const [x, y, w, h, area] = stats.data32S.subarray(i * 5, i * 5 + 5)
    if (w < 6 * mm && h < 6 * mm) continue
    const touches = x <= edge || y <= edge || x + w >= W - edge || y + h >= H - edge
    const thin = Math.min(w, h) < 6 * mm && Math.max(w, h) > 30 * mm
    if (touches && thin) continue
    // Bare lines across most of the page are paper or scanner edges (or the binding),
    // wherever they lie, alone or joined into a frame; printed content that large is a
    // dense blob, while an edge frame is little more than its outline.
    // (Its mean stroke width area / (w + h) stays within ~1.5 line widths for a line, an L
    // or a U; a ragged edge with specks along it still fills only a sliver of its box.)
    if ((w > W * 0.5 || h > H * 0.5) && (area / (w + h) < 4 * mm || area < w * h * 0.08)) continue
    blobs.push({ x, y, width: w, height: h, area })
  }
  const kept = staves.length ? keepBlobs(blobs, staves.map((t) => ({ x0: t.x0 * s, x1: t.x1 * s, top: t.top * s, bottom: t.bottom * s })), mm) : blobs
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of kept) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.width)
    y1 = Math.max(y1, b.y + b.height)
  }
  ;[src, small, bin, paper, k, labels, stats, cents].forEach((m) => m.delete())
  if (x1 < 0) return null
  // Undo the dilation growth (half kernel each side), then scale back up.
  const shrink = Math.round(1 * mm)
  const b = {
    x: Math.max(0, (x0 + shrink) / s),
    y: Math.max(0, (y0 + shrink) / s),
    width: 0,
    height: 0,
  }
  b.width = Math.min(img.width, (x1 - shrink) / s) - b.x
  b.height = Math.min(img.height, (y1 - shrink) / s) - b.y
  return b
}

/**
 * How far past the staff ends the music column reaches. Blobs are dilated by ~1mm, so a
 * margin note starting 3mm or more beside the staves stays outside.
 */
const COLUMN_SLACK_MM = 2

interface Blob extends Box {
  /** Pixel count of the component. */
  area: number
}

/** Gap below the last staff up to which footer lines (copyright, page number) are kept. */
const FOOTER_GAP_MM = 15

/**
 * Selects the blobs that belong to the score, given staff boxes (all in work pixels):
 * - a sparse blob enclosing every staff is the sheet's outline, not content.
 * - the column of the music is the staves' horizontal span (plus COLUMN_SLACK_MM); a blob must
 *   lie at least half inside it. This drops the neighbouring page's edge after a split,
 *   binding shadows, stamps and notes in the side margins.
 * - within that column everything from the top of the page down to the last staff is
 *   kept: title, subtitle, composer, part name and tempo marks can sit far above the
 *   first staff, and losing them is much worse than keeping a stray mark.
 * - below the last staff, blobs are kept while each is within FOOTER_GAP_MM of what is
 *   already kept (copyright lines, page numbers), so distant smudges are dropped.
 */
function keepBlobs(blobs: Blob[], staves: { x0: number; x1: number; top: number; bottom: number }[], mm: number): Box[] {
  const L = Math.min(...staves.map((t) => t.x0)) - COLUMN_SLACK_MM * mm
  const R = Math.max(...staves.map((t) => t.x1)) + COLUMN_SLACK_MM * mm
  const top = Math.min(...staves.map((t) => t.top))
  const bottom = Math.max(...staves.map((t) => t.bottom))
  // The edge of a photographed sheet (paper against the desk, often with a soft shadow)
  // becomes a ring around all the music; real content that encloses every staff is dense.
  const frame = (b: Blob) =>
    b.x <= L && b.y <= top && b.x + b.width >= R && b.y + b.height >= bottom && b.area < b.width * b.height * 0.2
  const inColumn = blobs.filter((b) => !frame(b) && Math.min(b.x + b.width, R) - Math.max(b.x, L) >= b.width * 0.5)
  const kept = inColumn.filter((b) => b.y <= bottom)
  let edge = Math.max(bottom, ...kept.map((b) => b.y + b.height))
  const below = inColumn.filter((b) => b.y > bottom).sort((a, b) => a.y - b.y)
  for (const b of below) {
    if (b.y - edge > FOOTER_GAP_MM * mm) break
    kept.push(b)
    edge = Math.max(edge, b.y + b.height)
  }
  return kept
}

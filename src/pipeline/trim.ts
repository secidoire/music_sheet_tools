import type { CV, GrayImage } from './types.ts'
import { matFromGray } from './image.ts'

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
 * - scanner edges: thin, long blobs hugging the image border are ignored
 * Returns null when nothing remains (blank page).
 */
export function contentBox(cv: CV, img: GrayImage, dpi: number): Box | null {
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
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 1; i < n; i++) {
    const [x, y, w, h] = stats.data32S.subarray(i * 5, i * 5 + 4)
    if (w < 6 * mm && h < 6 * mm) continue
    const touches = x <= edge || y <= edge || x + w >= W - edge || y + h >= H - edge
    const thin = Math.min(w, h) < 6 * mm && Math.max(w, h) > 30 * mm
    if (touches && thin) continue
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x + w)
    y1 = Math.max(y1, y + h)
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

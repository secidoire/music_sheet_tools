import type { CV, GrayImage, WhitenSettings } from './types.ts'
import { grayFromMat, matFromGray } from './image.ts'

/**
 * Background whitening.
 *
 * - `levels`: flat-field the page by dividing by an estimated paper background
 *   (removes shadows and yellowing), then apply a level curve whose white/black
 *   points move inward with `strength`. Keeps anti-aliasing, so it looks natural.
 * - `adaptive`: adaptive-threshold binarisation. Pure black & white; `strength`
 *   raises the offset so faint smudges disappear.
 */
export function whiten(cv: CV, img: GrayImage, s: WhitenSettings, dpi: number): GrayImage {
  if (!s.enabled) return img
  return s.mode === 'adaptive' ? adaptive(cv, img, s.strength, dpi) : levels(cv, img, s.strength, dpi)
}

function levels(cv: CV, img: GrayImage, strength: number, dpi: number): GrayImage {
  const bg = estimateBackground(cv, img, dpi)
  const t = Math.min(100, Math.max(0, strength)) / 100
  // White point: anything at least this fraction of the paper brightness becomes white.
  const white = 0.97 - 0.27 * t
  // Black point: darken the ink a bit so thin lines don't wash out.
  const black = 0.05 + 0.25 * t
  const scale = 255 / (white - black)
  const lut = new Uint8Array(256 * 256)
  // lut[g * 256 + b] = level(g / b); b is the background at that pixel.
  for (let b = 0; b < 256; b++) {
    const bb = Math.max(b, 16)
    for (let g = 0; g < 256; g++) {
      const v = (Math.min(1, g / bb) - black) * scale
      lut[g * 256 + b] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
  const out = new Uint8Array(img.data.length)
  for (let i = 0; i < out.length; i++) out[i] = lut[img.data[i] * 256 + bg[i]]
  return { width: img.width, height: img.height, data: out }
}

/** Paper brightness per pixel: max-filter (removes dark ink) on a downscaled copy, then blur and upscale. */
function estimateBackground(cv: CV, img: GrayImage, dpi: number): Uint8Array {
  const small = 25 / dpi // work at ~25dpi
  const src = matFromGray(cv, img)
  const s = new cv.Mat()
  const sw = Math.max(8, Math.round(img.width * small))
  const sh = Math.max(8, Math.round(img.height * small))
  cv.resize(src, s, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA)
  // ~8mm dilation wipes out note heads, beams and most text.
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9))
  cv.dilate(s, s, k)
  cv.GaussianBlur(s, s, new cv.Size(9, 9), 0)
  const big = new cv.Mat()
  cv.resize(s, big, new cv.Size(img.width, img.height), 0, 0, cv.INTER_LINEAR)
  const out = new Uint8Array(big.data)
  ;[src, s, big, k].forEach((m) => m.delete())
  return out
}

/**
 * Above this resolution the Gaussian local mean is computed on a copy downscaled to it.
 * At 600dpi the 4mm window is ~95px wide and the full-resolution blur dominated export time;
 * the mean is smooth (σ ≈ 0.6mm) so it survives the round trip, while the comparison
 * against it still happens at full resolution. Differs from the full-resolution result
 * only in isolated edge pixels.
 */
const MEAN_DPI = 150

function adaptive(cv: CV, img: GrayImage, strength: number, dpi: number): GrayImage {
  const src = matFromGray(cv, img)
  // Block ≈ 4mm: larger than a note head, smaller than lighting gradients.
  const block = Math.round((4 / 25.4) * dpi) | 1
  const c = 6 + (Math.min(100, Math.max(0, strength)) / 100) * 24
  if (dpi <= MEAN_DPI) {
    const dst = new cv.Mat()
    cv.adaptiveThreshold(src, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, c)
    const out = grayFromMat(dst)
    src.delete()
    dst.delete()
    return out
  }
  const s = MEAN_DPI / dpi
  const small = new cv.Mat()
  cv.resize(src, small, new cv.Size(Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s))), 0, 0, cv.INTER_AREA)
  // Same σ as adaptiveThreshold derives from `block`, in downscaled pixels.
  const sigma = (0.3 * ((block - 1) * 0.5 - 1) + 0.8) * s
  cv.GaussianBlur(small, small, new cv.Size(0, 0), sigma, sigma, cv.BORDER_REPLICATE)
  const mean = new cv.Mat()
  cv.resize(small, mean, new cv.Size(img.width, img.height), 0, 0, cv.INTER_LINEAR)
  // adaptiveThreshold's THRESH_BINARY rule: white where src - mean > -ceil(c).
  const t = -Math.ceil(c)
  const m = mean.data
  const d = img.data
  const out = new Uint8Array(d.length)
  for (let i = 0; i < d.length; i++) out[i] = d[i] - m[i] > t ? 255 : 0
  ;[src, small, mean].forEach((x) => x.delete())
  return { width: img.width, height: img.height, data: out }
}

/**
 * Steepens edges of an already resampled page, in place. Scans are often 150–200dpi and
 * enlarging them to the export resolution turns every edge into a soft ramp several
 * pixels wide, which reads as blur. A sigmoid tone curve around the middle grey pulls
 * each ramp back to a narrow one at the new resolution — sharp but still anti-aliased —
 * and darkens thin grey staff lines on the way. Paper stays white and solid ink black.
 */
export function crispen(img: GrayImage): void {
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 / (1 + Math.exp(-(v - CRISP_CENTRE) / CRISP_WIDTH)))
  // Stretch so that 0 and 255 map to themselves.
  const lo = lut[0]
  const hi = lut[255]
  for (let v = 0; v < 256; v++) lut[v] = Math.round(((lut[v] - lo) * 255) / (hi - lo))
  const d = img.data
  for (let i = 0; i < d.length; i++) d[i] = lut[d[i]]
}

/** Grey level that becomes the edge, and how many levels the transition spans (smaller = harder). */
const CRISP_CENTRE = 175
const CRISP_WIDTH = 14

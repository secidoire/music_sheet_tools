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

function adaptive(cv: CV, img: GrayImage, strength: number, dpi: number): GrayImage {
  const src = matFromGray(cv, img)
  const dst = new cv.Mat()
  // Block ≈ 4mm: larger than a note head, smaller than lighting gradients.
  const block = Math.round((4 / 25.4) * dpi) | 1
  const c = 6 + (Math.min(100, Math.max(0, strength)) / 100) * 24
  cv.adaptiveThreshold(src, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, c)
  const out = grayFromMat(dst)
  src.delete()
  dst.delete()
  return out
}

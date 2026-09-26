import type { CV, GrayImage } from './types.ts'

type Mat = InstanceType<CV['Mat']>

export function matFromGray(cv: CV, img: GrayImage): Mat {
  const m = new cv.Mat(img.height, img.width, cv.CV_8UC1)
  m.data.set(img.data)
  return m
}

/** Copies the Mat's pixels out; the caller still owns (and must delete) the Mat. */
export function grayFromMat(m: Mat): GrayImage {
  return { width: m.cols, height: m.rows, data: new Uint8Array(m.data) }
}

export function resizeGray(cv: CV, img: GrayImage, scale: number): GrayImage {
  if (scale === 1) return img
  const src = matFromGray(cv, img)
  const dst = new cv.Mat()
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  cv.resize(src, dst, new cv.Size(w, h), 0, 0, scale < 1 ? cv.INTER_AREA : cv.INTER_LINEAR)
  const out = grayFromMat(dst)
  src.delete()
  dst.delete()
  return out
}

export function crop(img: GrayImage, x0: number, y0: number, w: number, h: number): GrayImage {
  x0 = Math.max(0, Math.round(x0))
  y0 = Math.max(0, Math.round(y0))
  w = Math.min(img.width - x0, Math.round(w))
  h = Math.min(img.height - y0, Math.round(h))
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const s = (y + y0) * img.width + x0
    out.set(img.data.subarray(s, s + w), y * w)
  }
  return { width: w, height: h, data: out }
}

export function rgbaToGray(img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): GrayImage {
  const { width, height, data } = img
  const out = new Uint8Array(width * height)
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
  }
  return { width, height, data: out }
}

/**
 * Binary "ink" mask (1 = ink) via adaptive threshold, robust to uneven scan lighting.
 * `blockPx` should be a few times the staff-line spacing at the image's resolution.
 */
export function inkMask(cv: CV, img: GrayImage, blockPx: number, c = 15): Uint8Array {
  const src = matFromGray(cv, img)
  const dst = new cv.Mat()
  const block = Math.max(3, Math.round(blockPx) | 1)
  cv.adaptiveThreshold(src, dst, 1, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, block, c)
  const out = new Uint8Array(dst.data)
  src.delete()
  dst.delete()
  return out
}

export function smooth1d(a: Float64Array, radius: number): Float64Array {
  const n = a.length
  const out = new Float64Array(n)
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + a[i]
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(n, i + radius + 1)
    out[i] = (prefix[hi] - prefix[lo]) / (hi - lo)
  }
  return out
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 8-bit single-channel image, row-major. Shared between worker, UI and Node scripts. */
export interface GrayImage {
  width: number
  height: number
  data: Uint8Array
}

/** OpenCV.js module type. The runtime instance is injected (worker or Node), never imported directly. */
export type CV = typeof import('@techstark/opencv-js')

export type WhitenMode = 'levels' | 'adaptive'
export type VAlign = 'top' | 'center'
/** Clockwise quarter turn applied to the source page before anything else. */
export type Rotation = 0 | 90 | 180 | 270

/**
 * Result of the automatic detection for one source page.
 * All geometry is resolution-independent (fractions of the page / degrees)
 * so it can be computed on a low-res render and applied to a 300dpi one.
 */
export interface PageAnalysis {
  /** Orientation the rest of the analysis was done in (auto-detected unless forced). */
  rotation: Rotation
  /** Orientation the automatic detection chose. */
  autoRotation: Rotation
  /** Page looks like a two-page spread (landscape once rotated). */
  isSpread: boolean
  /** Detected split position as a fraction of page width. */
  splitX: number
  /** How the split position was found. */
  splitMethod: 'gutter' | 'shadow' | 'center'
  /** Detected skew in degrees for each output half (one entry when not split). Positive = rotate counter-clockwise to fix. */
  angles: number[]
  /** Detected skew for the page as a whole, used when the user turns splitting off. */
  wholeAngle: number
}

export interface WhitenSettings {
  enabled: boolean
  mode: WhitenMode
  /** 0..100 */
  strength: number
}

/** Settings that apply to every page unless overridden. */
export interface GlobalSettings {
  whiten: WhitenSettings
  trim: boolean
  /** Output margin on A4 in millimetres. */
  marginMm: number
  vAlign: VAlign
  /** Upper bound for enlarging content beyond its original physical size. */
  maxUpscale: number
}

/** Per-page user overrides. `undefined` fields fall back to the automatic result. */
export interface PageOverrides {
  /** Skip every correction and just place the original page on A4. */
  bypass?: boolean
  split?: boolean
  splitX?: number
  /** Manual angle per output half (index 0 = left/whole, 1 = right). */
  angles?: (number | undefined)[]
}

/** Fully resolved parameters for rendering one source page. */
export interface ResolvedPage {
  bypass: boolean
  rotation: Rotation
  split: boolean
  splitX: number
  angles: number[]
  whiten: WhitenSettings
  trim: boolean
  marginMm: number
  vAlign: VAlign
  maxUpscale: number
}

export const A4_MM = { width: 210, height: 297 }
export const MM_PER_INCH = 25.4

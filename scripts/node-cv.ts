import { createRequire } from 'node:module'
import type { CV } from '../src/pipeline/types.ts'

/** Loads OpenCV.js in Node (same build the browser worker uses; vendor/opencv is CommonJS). */
export async function loadCvNode(): Promise<CV> {
  const require = createRequire(import.meta.url)
  const mod = require('../vendor/opencv/opencv.js')
  // The UMD export is a promise-like that resolves to the initialised module.
  const cv = await mod
  return cv as CV
}

import { createRequire } from 'node:module'
import type { CV } from '../src/pipeline/types.ts'

/** Loads OpenCV.js in Node (same build the browser worker uses). */
export async function loadCvNode(): Promise<CV> {
  const require = createRequire(import.meta.url)
  const mod = require('@techstark/opencv-js')
  // The UMD export is a promise-like that resolves to the initialised module.
  const cv = await mod
  return cv as CV
}

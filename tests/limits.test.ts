import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_BYTES, MAX_FILES, MAX_PAGES, MAX_PIXELS, validateDimensions, validateFiles, validatePageCount } from '../src/lib/limits.ts'
import { resizeGray } from '../src/pipeline/image.ts'

test('file limits reject empty, oversized and excessive input before parsing', () => {
  validateFiles([{ size: MAX_BYTES }])
  validateFiles(Array.from({ length: MAX_FILES }, () => ({ size: 1 })))
  for (const files of [[], [{ size: 0 }], [{ size: NaN }], [{ size: MAX_BYTES }, { size: 1 }], Array.from({ length: MAX_FILES + 1 }, () => ({ size: 1 }))]) {
    assert.throws(() => validateFiles(files))
  }
})

test('page budget includes PDFs and images in the same document', () => {
  validatePageCount(MAX_PAGES)
  for (const count of [0, -1, NaN, Infinity, 1.5, MAX_PAGES + 1]) assert.throws(() => validatePageCount(count))
})

test('normal 600dpi A3 export fits, invalid and inflated dimensions fail', () => {
  validateDimensions(9921, 7016)
  validateDimensions(10000, MAX_PIXELS / 10000)
  for (const [w, h] of [[0, 1], [-1, 10], [NaN, 1], [Infinity, 1], [1.5, 3], [10000, 8001], [32769, 1]]) {
    assert.throws(() => validateDimensions(w, h))
  }
})

test('staff-driven rescaling rejects excessive output before touching OpenCV', () => {
  // Any access to CV would fail with TypeError instead of the explicit limit error.
  assert.throws(() => resizeGray({} as never, { width: 10000, height: 8000, data: new Uint8Array(0) }, 5), /Page exceeds/)
})

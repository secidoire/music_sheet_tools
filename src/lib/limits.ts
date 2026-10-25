/** Per document limits, checked in both the UI thread and processing workers. */
export const MAX_FILES = 100
export const MAX_BYTES = 128 * 1024 * 1024
export const MAX_PAGES = 200
// Allows a 600dpi A3 spread (~70 Mpx), with room for rounding.
export const MAX_PIXELS = 80_000_000
export const MAX_EDGE = 32_768

export function validateFiles(files: readonly { size: number }[]) {
  if (!files.length || files.length > MAX_FILES) throw new Error(`Choose 1–${MAX_FILES} files.`)
  let bytes = 0
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('Empty or invalid file.')
    bytes += file.size
    if (bytes > MAX_BYTES) throw new Error('Files exceed the 128 MiB document limit.')
  }
}

export function validatePageCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PAGES) {
    throw new Error(`Documents must contain 1–${MAX_PAGES} pages.`)
  }
}

/** Call before allocating a raster, canvas, RGBA buffer or OpenCV matrix. */
export function validateDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
    throw new Error('Page exceeds the 80 megapixel / 32768 pixel edge limit. Reduce its resolution.')
  }
}

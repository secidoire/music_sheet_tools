// The legacy build polyfills very recent JS (e.g. Map#getOrInsertComputed) missing in
// current Safari/Chrome releases; the modern build throws there.
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { RasterPayload } from '../worker/protocol.ts'
import { pageSizeCorrection } from '../pipeline/paper.ts'

/**
 * This module also runs inside the processing workers, which rasterise pages themselves
 * when there are several of them (see useProject). There is no document there, so pdf.js
 * runs in-thread and draws on OffscreenCanvas, and glyphs are drawn as paths since fonts
 * can't be registered with a document.
 */
const inWorker = typeof document === 'undefined'
if (!inWorker) GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// Absolute, since pdf.js resolves these in whichever thread fetches them.
const vendor = new URL(`${import.meta.env.BASE_URL}vendor/pdfjs/`, globalThis.location.href).href

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  if (inWorker) {
    // pdf.js runs its "worker" side in this thread when it finds it on globalThis.
    ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
  }
  return getDocument({
    data: new Uint8Array(data),
    // Scanned scores are often JBIG2/JPEG2000; their decoders are wasm files served under `base`.
    wasmUrl: `${vendor}wasm/`,
    cMapUrl: `${vendor}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${vendor}standard_fonts/`,
    // useWorkerFetch: its default is worked out from document.baseURI.
    ...(inWorker && { CanvasFactory: OffscreenCanvasFactory, FilterFactory: NoFilterFactory, disableFontFace: true, useWorkerFetch: true }),
  }).promise
}

/** A canvas that works on the main thread and in a worker. */
export function newCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (inWorker) return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

/** 2D context of either kind of canvas, set up for reading pixels back. */
export function context2d(canvas: HTMLCanvasElement | OffscreenCanvas) {
  return canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
}

type CanvasAndContext = { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null }

/** pdf.js's canvas factory interface (its DOM one needs a document). */
class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = new OffscreenCanvas(width, height)
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) }
  }
  reset(c: CanvasAndContext, width: number, height: number) {
    c.canvas!.width = width
    c.canvas!.height = height
  }
  destroy(c: CanvasAndContext) {
    c.canvas!.width = c.canvas!.height = 0
    c.canvas = null
    c.context = null
  }
}

/** pdf.js's filter factory interface without SVG filters (they need a document); as its base class does. */
class NoFilterFactory {
  addFilter() { return 'none' }
  addHCMFilter() { return 'none' }
  addAlphaFilter() { return 'none' }
  addLuminosityFilter() { return 'none' }
  addKnockoutFilter() { return 'none' }
  addHighlightHCMFilter() { return 'none' }
  addSelectionHCMFilter() { return 'none' }
  addSelectionFilter() { return 'none' }
  createSelectionStyle() { return null }
  destroy() {}
}

/**
 * Largest canvas edge used while rasterising. Pages are rendered in tiles no larger than
 * this and assembled into one gray buffer, which keeps every canvas under the iOS Safari
 * area limit (~16.7 Mpx) even for 600dpi A3 spreads.
 */
const TILE = 4096

/** Rasterises one page to 8-bit gray on a white background. The buffer is meant to be transferred to the worker. */
export async function renderPage(doc: PDFDocumentProxy, pageNo: number, dpi: number): Promise<RasterPayload> {
  const page = await doc.getPage(pageNo)
  // Render at `dpi` of the real paper size, which may differ from the declared one.
  const [x0, y0, x1, y1] = page.view
  const k = pageSizeCorrection(((x1 - x0) / 72) * 25.4, ((y1 - y0) / 72) * 25.4)
  const viewport = page.getViewport({ scale: (dpi / 72) * k })
  const width = Math.round(viewport.width)
  const height = Math.round(viewport.height)
  const gray = new Uint8Array(width * height)
  const canvas = newCanvas(1, 1)
  try {
    for (let ty = 0; ty < height; ty += TILE) {
      for (let tx = 0; tx < width; tx += TILE) {
        const tw = Math.min(TILE, width - tx)
        const th = Math.min(TILE, height - ty)
        canvas.width = tw
        canvas.height = th
        const ctx = context2d(canvas)
        if (!ctx) throw new Error(`canvas ${tw}x${th} unavailable`)
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, tw, th)
        // pdf.js types the canvas as a DOM one; an OffscreenCanvas works the same in a worker.
        await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: ctx as CanvasRenderingContext2D, viewport, transform: [1, 0, 0, 1, -tx, -ty] }).promise
        const { data } = ctx.getImageData(0, 0, tw, th)
        // A canvas the browser couldn't allocate reads back transparent; the white fill makes that detectable.
        if (data[3] === 0) throw new Error(`canvas ${tw}x${th} unavailable`)
        for (let y = 0; y < th; y++) {
          let o = (ty + y) * width + tx
          for (let x = 0, i = y * tw * 4; x < tw; x++, i += 4) gray[o++] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
        }
      }
    }
  } finally {
    canvas.width = canvas.height = 0
    page.cleanup()
  }
  return { width, height, gray: gray.buffer, dpi }
}

/** Downscaled JPEG of a raster for display (the full-res pixels go to the worker). */
export async function rasterToJpeg(r: RasterPayload, maxWidth: number): Promise<Blob> {
  const src = new OffscreenCanvas(r.width, r.height)
  const g = new Uint8Array(r.gray)
  const rgba = new Uint8ClampedArray(r.width * r.height * 4)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    rgba[j] = rgba[j + 1] = rgba[j + 2] = g[i]
    rgba[j + 3] = 255
  }
  src.getContext('2d')!.putImageData(new ImageData(rgba, r.width, r.height), 0, 0)
  const s = Math.min(1, maxWidth / r.width)
  const dst = new OffscreenCanvas(Math.round(r.width * s), Math.round(r.height * s))
  const ctx = dst.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, dst.width, dst.height)
  return dst.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
}

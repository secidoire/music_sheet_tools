/// <reference lib="webworker" />
import type { CV, GrayImage } from '../pipeline/types.ts'
import { resizeGray } from '../pipeline/image.ts'
import { analyzePage, ANALYSIS_DPI, renderPage, staffDpiScale } from '../pipeline/process.ts'
import type { RasterPayload, RequestMessage, ResponseMessage, WorkerRequest, WorkerResponses } from './protocol.ts'
import { encodeSheet, PdfBuilder } from './pdf-builder.ts'

declare const self: DedicatedWorkerGlobalScope

let cvPromise: Promise<CV> | null = null

/**
 * OpenCV.js is a 13MB UMD script served from public/vendor (not bundled).
 * Importing it as a module runs the UMD wrapper, which assigns `globalThis.cv`
 * to a promise of the initialised module.
 */
function loadCv(): Promise<CV> {
  cvPromise ??= (async () => {
    await import(/* @vite-ignore */ `${import.meta.env.BASE_URL}vendor/opencv.js`)
    return await (globalThis as unknown as { cv: Promise<CV> }).cv
  })()
  return cvPromise
}

/** Gray sources at a real ANALYSIS_DPI, kept for re-rendering previews when settings change. */
const sources = new Map<string, { gray: GrayImage; dpiScale: number }>()

function toGray(r: RasterPayload): GrayImage {
  return { width: r.width, height: r.height, data: new Uint8Array(r.gray) }
}

async function encodeJpeg(img: GrayImage, quality = 0.85): Promise<Blob> {
  const canvas = new OffscreenCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')!
  const id = ctx.createImageData(img.width, img.height)
  const d = id.data
  for (let i = 0, j = 0; i < img.data.length; i++, j += 4) {
    d[j] = d[j + 1] = d[j + 2] = img.data[i]
    d[j + 3] = 255
  }
  ctx.putImageData(id, 0, 0)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

async function handle(req: WorkerRequest): Promise<WorkerResponses[WorkerRequest['type']]> {
  const cv = await loadCv()
  switch (req.type) {
    case 'init':
      return { ok: true }
    case 'reset':
      sources.clear()
      return { ok: true }
    case 'analyze': {
      let gray = toGray(req.raster)
      const dpiScale = staffDpiScale(cv, gray, req.raster.dpi)
      const real = req.raster.dpi * dpiScale
      if (Math.abs(real - ANALYSIS_DPI) > 0.5) gray = resizeGray(cv, gray, ANALYSIS_DPI / real)
      sources.set(req.pageKey, { gray, dpiScale })
      return { analysis: analyzePage(cv, gray, ANALYSIS_DPI, undefined, dpiScale).analysis }
    }
    case 'reanalyze': {
      const src = sources.get(req.pageKey)
      if (!src) throw new Error(`unknown page ${req.pageKey}`)
      return { analysis: analyzePage(cv, src.gray, ANALYSIS_DPI, req.rotation, src.dpiScale).analysis }
    }
    case 'preview': {
      const src = sources.get(req.pageKey)
      if (!src) throw new Error(`unknown page ${req.pageKey}`)
      const sheets = renderPage(cv, src.gray, ANALYSIS_DPI, req.page, req.outDpi)
      return { sheets: await Promise.all(sheets.map((s) => encodeJpeg(s.image))) }
    }
    case 'exportPage': {
      const sheets = renderPage(cv, toGray(req.raster), req.raster.dpi * req.page.dpiScale, req.page, req.outDpi)
      const bilevel = req.page.whiten.enabled && req.page.whiten.mode === 'adaptive'
      return { sheets: await Promise.all(sheets.map((s) => encodeSheet(s.image, bilevel))) }
    }
    case 'buildPdf': {
      const builder = await PdfBuilder.create()
      for (const s of req.sheets) builder.addPage(s)
      return { pdf: await builder.save() }
    }
  }
}

// Requests are handled strictly one at a time, in arrival order.
let queue: Promise<unknown> = Promise.resolve()
self.onmessage = (e: MessageEvent<RequestMessage>) => {
  const { id, ...req } = e.data
  queue = queue.then(async () => {
    let msg: ResponseMessage
    let transfer: Transferable[] = []
    try {
      const result = await handle(req as WorkerRequest)
      transfer = transferables(result)
      msg = { id, ok: true, result }
    } catch (err) {
      msg = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    self.postMessage(msg, transfer)
  })
}

/** Buffers in a result that are handed over instead of copied. */
function transferables(result: WorkerResponses[WorkerRequest['type']]): Transferable[] {
  if ('pdf' in result) return [result.pdf.buffer]
  if ('sheets' in result) return result.sheets.flatMap((s) => (s instanceof Blob ? [] : [s.data.buffer]))
  return []
}

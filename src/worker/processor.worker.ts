/// <reference lib="webworker" />
import type { CV, GrayImage } from '../pipeline/types.ts'
import { resizeGray } from '../pipeline/image.ts'
import { analyzePage, ANALYSIS_DPI, renderPage } from '../pipeline/process.ts'
import type { RasterPayload, RequestMessage, ResponseMessage, WorkerRequest, WorkerResponses } from './protocol.ts'
import { PdfBuilder } from './pdf-builder.ts'

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

/** Gray sources at ANALYSIS_DPI, kept for re-rendering previews when settings change. */
const sources = new Map<string, GrayImage>()
let builder: PdfBuilder | null = null

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
      builder = null
      return { ok: true }
    case 'analyze': {
      let gray = toGray(req.raster)
      if (req.raster.dpi !== ANALYSIS_DPI) gray = resizeGray(cv, gray, ANALYSIS_DPI / req.raster.dpi)
      sources.set(req.pageKey, gray)
      return { analysis: analyzePage(cv, gray).analysis }
    }
    case 'preview': {
      const src = sources.get(req.pageKey)
      if (!src) throw new Error(`unknown page ${req.pageKey}`)
      const sheets = renderPage(cv, src, ANALYSIS_DPI, req.page, req.outDpi)
      return { sheets: await Promise.all(sheets.map((s) => encodeJpeg(s.image))) }
    }
    case 'exportBegin':
      builder = await PdfBuilder.create()
      return { ok: true }
    case 'exportPage': {
      if (!builder) throw new Error('export not started')
      const sheets = renderPage(cv, toGray(req.raster), req.raster.dpi, req.page, req.outDpi)
      for (const s of sheets) builder.addGrayPage(s.image, req.page.whiten.enabled && req.page.whiten.mode === 'adaptive')
      return { sheets: sheets.length }
    }
    case 'exportEnd': {
      if (!builder) throw new Error('export not started')
      const pdf = await builder.save()
      builder = null
      return { pdf }
    }
  }
}

// Requests are handled strictly one at a time, in arrival order.
let queue: Promise<unknown> = Promise.resolve()
self.onmessage = (e: MessageEvent<RequestMessage>) => {
  const { id, ...req } = e.data
  queue = queue.then(async () => {
    let msg: ResponseMessage
    const transfer: Transferable[] = []
    try {
      const result = await handle(req as WorkerRequest)
      if ('pdf' in result) transfer.push(result.pdf.buffer)
      msg = { id, ok: true, result }
    } catch (err) {
      msg = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    self.postMessage(msg, transfer)
  })
}

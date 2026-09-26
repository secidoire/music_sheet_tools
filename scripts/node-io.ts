// Node-side helpers shared by the debug scripts: PDF rasterization and PNG/JPEG output.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { GrayImage } from '../src/pipeline/types.ts'
import { pageSizeCorrection } from '../src/pipeline/paper.ts'

export function listPdfs(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? listPdfs(p) : p.toLowerCase().endsWith('.pdf') ? [p] : []
  }).sort()
}

export async function openPdf(path: string): Promise<PDFDocumentProxy> {
  return getDocument({
    data: new Uint8Array(readFileSync(path)),
    verbosity: 0,
    wasmUrl: resolve('node_modules/pdfjs-dist/wasm') + '/',
    standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/',
    cMapUrl: resolve('node_modules/pdfjs-dist/cmaps') + '/',
  }).promise
}

export async function renderPageRGBA(doc: PDFDocumentProxy, pageNo: number, dpi: number) {
  const page = await doc.getPage(pageNo)
  // Render at `dpi` of the real paper size, which may differ from the declared one.
  const [x0, y0, x1, y1] = page.view
  const k = pageSizeCorrection(((x1 - x0) / 72) * 25.4, ((y1 - y0) / 72) * 25.4)
  const viewport = page.getViewport({ scale: (dpi / 72) * k })
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // pdf.js accepts a node canvas context at runtime; its typings expect the DOM one.
  await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise
  page.cleanup()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export function rgbaToGray(img: { width: number; height: number; data: Uint8ClampedArray }): GrayImage {
  const { width, height, data } = img
  const out = new Uint8Array(width * height)
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
  }
  return { width, height, data: out }
}

/** Encode an RGBA buffer (or gray image) to a file, optionally downscaled for quick viewing. */
export async function saveImage(path: string, img: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, channels: 1 | 4, maxSide = 1600) {
  const { width, height } = img
  const src = createCanvas(width, height)
  const sctx = src.getContext('2d')
  const id = sctx.createImageData(width, height)
  if (channels === 4) id.data.set(img.data)
  else for (let i = 0; i < width * height; i++) {
    const v = img.data[i]
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v
    id.data[i * 4 + 3] = 255
  }
  sctx.putImageData(id, 0, 0)
  const s = Math.min(1, maxSide / Math.max(width, height))
  const dst = createCanvas(Math.round(width * s), Math.round(height * s))
  dst.getContext('2d').drawImage(src, 0, 0, dst.width, dst.height)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path, path.endsWith('.png') ? dst.toBuffer('image/png') : dst.toBuffer('image/jpeg', 85))
}

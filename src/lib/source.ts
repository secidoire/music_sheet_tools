import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { RasterPayload } from '../worker/protocol.ts'
import { context2d, newCanvas, openPdf, renderPage } from './pdf.ts'
import { assumedLongMm } from '../pipeline/paper.ts'

/** One page of the loaded input, rasterised on demand. */
export interface SourcePage {
  /** Renders the page at `dpi`. Images are never enlarged, so `raster.dpi` may come back lower. */
  render(dpi: number): Promise<RasterPayload>
}

export interface Source {
  /** Display name: the first file, plus how many more there are. */
  name: string
  pages: SourcePage[]
  destroy(): Promise<void>
}

export const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
export const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|avif)$/i.test(f.name)

/**
 * Opens PDFs and image files as one list of pages, in file-name order
 * (so page1.jpg, page2.jpg, …, page10.jpg come out as numbered).
 */
export async function openSources(files: File[]): Promise<Source> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const docs: PDFDocumentProxy[] = []
  const pages: SourcePage[] = []
  try {
    for (const f of sorted) {
      if (isPdf(f)) {
        const doc = await openPdf(await f.arrayBuffer())
        docs.push(doc)
        for (let n = 1; n <= doc.numPages; n++) pages.push({ render: (dpi) => renderPage(doc, n, dpi) })
      } else {
        // Decode once up front so an unsupported format fails on load, not halfway through.
        const bmp = await decode(f)
        const size = { width: bmp.width, height: bmp.height }
        bmp.close()
        pages.push({ render: (dpi) => renderImage(f, size, dpi) })
      }
    }
  } catch (e) {
    await Promise.all(docs.map((d) => d.loadingTask.destroy()))
    throw e
  }
  const name = sorted.length === 1 ? sorted[0].name : `${sorted[0].name} ほか${sorted.length - 1}件`
  return { name, pages, destroy: async () => void (await Promise.all(docs.map((d) => d.loadingTask.destroy()))) }
}

async function decode(f: File): Promise<ImageBitmap> {
  try {
    // Photos carry their rotation in EXIF; apply it like every image viewer does.
    return await createImageBitmap(f, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`${f.name} はこのブラウザでは開けない形式です`)
  }
}

/** Resolution an image is taken to have: its paper size is unknown, so see `assumedLongMm`. */
export function nominalDpi(width: number, height: number): number {
  return Math.max(width, height) / (assumedLongMm(width, height) / 25.4)
}

/** Same tile limit as the PDF rasteriser: keeps every canvas under mobile Safari's area cap. */
const TILE = 4096

async function renderImage(f: File, size: { width: number; height: number }, dpi: number): Promise<RasterPayload> {
  const native = nominalDpi(size.width, size.height)
  const k = Math.min(1, dpi / native)
  const width = Math.max(1, Math.round(size.width * k))
  const height = Math.max(1, Math.round(size.height * k))
  const bmp = await decode(f)
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
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(bmp, tx / k, ty / k, tw / k, th / k, 0, 0, tw, th)
        const { data } = ctx.getImageData(0, 0, tw, th)
        if (data[3] === 0) throw new Error(`canvas ${tw}x${th} unavailable`)
        for (let y = 0; y < th; y++) {
          let o = (ty + y) * width + tx
          for (let x = 0, i = y * tw * 4; x < tw; x++, i += 4) gray[o++] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
        }
      }
    }
  } finally {
    canvas.width = canvas.height = 0
    bmp.close()
  }
  return { width, height, gray: gray.buffer, dpi: native * k }
}

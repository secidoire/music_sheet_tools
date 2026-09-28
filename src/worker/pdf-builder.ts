import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib'
import type { GrayImage } from '../pipeline/types.ts'
import { A4_MM, MM_PER_INCH } from '../pipeline/types.ts'

const PT_PER_MM = 72 / MM_PER_INCH

/** A page raster already compressed for embedding, so each worker can encode its own pages. */
export interface EncodedSheet {
  width: number
  height: number
  bilevel: boolean
  /** zlib (FlateDecode) data of the DeviceGray samples. */
  data: Uint8Array
}

/**
 * Compresses a gray raster losslessly for `PdfBuilder`. Binarised pages are packed to
 * 1 bit per pixel.
 */
export async function encodeSheet(img: GrayImage, bilevel: boolean): Promise<EncodedSheet> {
  const raw = bilevel ? pack1bit(img) : img.data
  const stream = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'))
  const data = new Uint8Array(await new Response(stream).arrayBuffer())
  return { width: img.width, height: img.height, bilevel, data }
}

/**
 * Assembles A4 pages from encoded gray rasters.
 * Images are embedded directly as Flate-compressed DeviceGray XObjects (pdf-lib's
 * embedPng would expand them to RGB).
 */
export class PdfBuilder {
  private doc: PDFDocument

  private constructor(doc: PDFDocument) {
    this.doc = doc
  }

  static async create() {
    const doc = await PDFDocument.create()
    doc.setProducer('music_sheet_tools')
    doc.setCreator('music_sheet_tools')
    return new PdfBuilder(doc)
  }

  addPage(s: EncodedSheet) {
    const stream = this.doc.context.stream(s.data, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: s.width,
      Height: s.height,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: s.bilevel ? 1 : 8,
      Filter: 'FlateDecode',
    })
    const ref = this.doc.context.register(stream)
    const pw = A4_MM.width * PT_PER_MM
    const ph = A4_MM.height * PT_PER_MM
    const page = this.doc.addPage([pw, ph])
    const name = page.node.newXObject('Im', ref)
    // The raster is A4 at the export resolution, so it simply fills the page.
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(pw, 0, 0, ph, 0, 0), drawObject(name), popGraphicsState())
  }

  save(): Promise<Uint8Array> {
    return this.doc.save({ useObjectStreams: true })
  }
}

/** 1 bit per pixel, MSB first, rows padded to whole bytes; 1 = white (DeviceGray). */
function pack1bit(img: GrayImage): Uint8Array {
  const { width, height, data } = img
  const stride = (width + 7) >> 3
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    const o = y * stride
    for (let x = 0; x < width; x++) {
      if (data[row + x] >= 128) out[o + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return out
}

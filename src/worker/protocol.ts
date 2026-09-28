import type { PageAnalysis, ResolvedPage, Rotation } from '../pipeline/types.ts'
import type { EncodedSheet } from './pdf-builder.ts'

/** 8-bit gray pixels as rendered by pdf.js on the main thread; the buffer is transferred, not copied. */
export interface RasterPayload {
  width: number
  height: number
  gray: ArrayBuffer
  dpi: number
}

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'reset' }
  /** Stores the page for later previews and runs the automatic detection. */
  | { type: 'analyze'; pageKey: string; raster: RasterPayload }
  /** Re-runs the detection on a stored page, turned by `rotation` (auto-detected when omitted). */
  | { type: 'reanalyze'; pageKey: string; rotation?: Rotation }
  /** Renders the corrected A4 sheet(s) of a stored page as JPEG blobs. */
  | { type: 'preview'; pageKey: string; page: ResolvedPage; outDpi: number }
  /** Renders and compresses the A4 sheet(s) of a page for the PDF; needs no stored state. */
  | { type: 'exportPage'; raster: RasterPayload; page: ResolvedPage; outDpi: number }
  /** Assembles the PDF from every sheet, in order. */
  | { type: 'buildPdf'; sheets: EncodedSheet[] }

export interface WorkerResponses {
  init: { ok: true }
  reset: { ok: true }
  analyze: { analysis: PageAnalysis }
  reanalyze: { analysis: PageAnalysis }
  preview: { sheets: Blob[] }
  exportPage: { sheets: EncodedSheet[] }
  buildPdf: { pdf: Uint8Array }
}

export type RequestMessage = WorkerRequest & { id: number }
export type ResponseMessage =
  | { id: number; ok: true; result: WorkerResponses[WorkerRequest['type']] }
  | { id: number; ok: false; error: string }

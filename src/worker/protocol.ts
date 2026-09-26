import type { PageAnalysis, ResolvedPage } from '../pipeline/types.ts'

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
  /** Renders the corrected A4 sheet(s) of a stored page as JPEG blobs. */
  | { type: 'preview'; pageKey: string; page: ResolvedPage; outDpi: number }
  | { type: 'exportBegin' }
  | { type: 'exportPage'; raster: RasterPayload; page: ResolvedPage; outDpi: number }
  | { type: 'exportEnd' }

export interface WorkerResponses {
  init: { ok: true }
  reset: { ok: true }
  analyze: { analysis: PageAnalysis }
  preview: { sheets: Blob[] }
  exportBegin: { ok: true }
  exportPage: { sheets: number }
  exportEnd: { pdf: Uint8Array }
}

export type RequestMessage = WorkerRequest & { id: number }
export type ResponseMessage =
  | { id: number; ok: true; result: WorkerResponses[WorkerRequest['type']] }
  | { id: number; ok: false; error: string }

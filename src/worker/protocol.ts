import type { PageAnalysis, ResolvedPage, Rotation } from '../pipeline/types.ts'

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
  | { type: 'exportBegin' }
  | { type: 'exportPage'; raster: RasterPayload; page: ResolvedPage; outDpi: number }
  | { type: 'exportEnd' }

export interface WorkerResponses {
  init: { ok: true }
  reset: { ok: true }
  analyze: { analysis: PageAnalysis }
  reanalyze: { analysis: PageAnalysis }
  preview: { sheets: Blob[] }
  exportBegin: { ok: true }
  exportPage: { sheets: number }
  exportEnd: { pdf: Uint8Array }
}

export type RequestMessage = WorkerRequest & { id: number }
export type ResponseMessage =
  | { id: number; ok: true; result: WorkerResponses[WorkerRequest['type']] }
  | { id: number; ok: false; error: string }

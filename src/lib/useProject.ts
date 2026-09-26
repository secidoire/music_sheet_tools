import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { GlobalSettings, PageAnalysis, PageOverrides } from '../pipeline/types.ts'
import { DEFAULT_SETTINGS } from '../pipeline/defaults.ts'
import { ANALYSIS_DPI, resolvePage } from '../pipeline/process.ts'
import { ProcessorClient } from '../worker/client.ts'
import { openPdf, rasterToJpegUrl, renderPage } from './pdf.ts'

export const PREVIEW_DPI = 100
/** Export resolutions to fall back through when the browser can't allocate a canvas that large. */
const EXPORT_FALLBACK = [600, 400, 300, 200]

export interface PageState {
  key: string
  pageNo: number
  /** Source render (JPEG) for display. */
  sourceUrl?: string
  sourceSize?: { width: number; height: number }
  analysis?: PageAnalysis
  overrides: PageOverrides
  previewUrls?: string[]
  /** Signature of the settings the current preview was rendered with. */
  previewSig?: string
  error?: string
}

export interface ExportProgress {
  done: number
  total: number
}

let client: ProcessorClient | null = null
const getClient = () => (client ??= new ProcessorClient())

export function useProject() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [pages, setPages] = useState<PageState[]>([])
  const [settings, setSettings] = useState<GlobalSettings>(DEFAULT_SETTINGS)
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null)
  const [exporting, setExporting] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportDpi, setExportDpi] = useState(600)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const loadGen = useRef(0)

  const updatePage = useCallback((key: string, patch: Partial<PageState> | ((p: PageState) => Partial<PageState>)) => {
    setPages((ps) => ps.map((p) => (p.key === key ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)))
  }, [])

  const load = useCallback(async (file: File) => {
    const gen = ++loadGen.current
    setError(null)
    try {
      const c = getClient()
      await c.call({ type: 'reset' })
      await docRef.current?.loadingTask.destroy()
      setPages((old) => {
        for (const p of old) [p.sourceUrl, ...(p.previewUrls ?? [])].forEach((u) => u && URL.revokeObjectURL(u))
        return []
      })
      const doc = await openPdf(await file.arrayBuffer())
      docRef.current = doc
      setFileName(file.name)
      setSelected(0)
      const initial: PageState[] = Array.from({ length: doc.numPages }, (_, i) => ({
        key: `${gen}:${i + 1}`,
        pageNo: i + 1,
        overrides: {},
      }))
      setPages(initial)
      setLoading({ done: 0, total: doc.numPages })
      for (const p of initial) {
        if (gen !== loadGen.current) return
        try {
          const raster = await renderPage(doc, p.pageNo, ANALYSIS_DPI)
          const sourceUrl = await rasterToJpegUrl(raster, 1600)
          const sourceSize = { width: raster.width, height: raster.height }
          const { analysis } = await c.call({ type: 'analyze', pageKey: p.key, raster }, [raster.gray])
          if (gen !== loadGen.current) return
          updatePage(p.key, { sourceUrl, sourceSize, analysis })
        } catch (e) {
          updatePage(p.key, { error: String(e) })
        }
        setLoading({ done: p.pageNo, total: doc.numPages })
      }
      setLoading(null)
    } catch (e) {
      setError(`PDFを読み込めませんでした: ${e instanceof Error ? e.message : e}`)
      setLoading(null)
    }
  }, [updatePage])

  // Preview scheduler: one request in flight at a time, selected page first.
  const inFlight = useRef<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (inFlight.current || exporting) return
    const stale = (p: PageState) => p.analysis && !p.error && sig(p, settings) !== p.previewSig
    const order = [pages[selected], ...pages].filter(Boolean)
    const next = order.find(stale)
    if (!next || !next.analysis) return
    const resolved = resolvePage(next.analysis, settings, next.overrides)
    const s = sig(next, settings)
    inFlight.current = next.key
    getClient()
      .call({ type: 'preview', pageKey: next.key, page: resolved, outDpi: PREVIEW_DPI })
      .then(({ sheets }) => {
        const urls = sheets.map((b) => URL.createObjectURL(b))
        updatePage(next.key, (p) => {
          p.previewUrls?.forEach((u) => URL.revokeObjectURL(u))
          return { previewUrls: urls, previewSig: s }
        })
      })
      .catch((e) => updatePage(next.key, { error: String(e) }))
      .finally(() => {
        inFlight.current = null
        setTick((t) => t + 1)
      })
  }, [pages, settings, selected, exporting, tick, updatePage])

  const setOverrides = useCallback(
    (key: string, o: PageOverrides | ((prev: PageOverrides) => PageOverrides)) =>
      updatePage(key, (p) => ({ overrides: typeof o === 'function' ? o(p.overrides) : o })),
    [updatePage],
  )

  const exportPdf = useCallback(async () => {
    const doc = docRef.current
    if (!doc) return
    const c = getClient()
    setExporting({ done: 0, total: pages.length })
    try {
      await c.call({ type: 'exportBegin' })
      for (const [i, p] of pages.entries()) {
        if (!p.analysis) continue
        const page = resolvePage(p.analysis, settings, p.overrides)
        // Very large canvases fail on memory-constrained devices (e.g. iOS); retry at a lower resolution.
        for (const dpi of EXPORT_FALLBACK.filter((d) => d <= exportDpi)) {
          try {
            const raster = await renderPage(doc, p.pageNo, dpi)
            await c.call({ type: 'exportPage', raster, page, outDpi: dpi }, [raster.gray])
            break
          } catch (e) {
            if (dpi === EXPORT_FALLBACK[EXPORT_FALLBACK.length - 1]) throw e
            console.warn(`page ${p.pageNo}: export at ${dpi}dpi failed, retrying lower`, e)
          }
        }
        setExporting({ done: i + 1, total: pages.length })
      }
      const { pdf } = await c.call({ type: 'exportEnd' })
      const base = (fileName ?? 'score').replace(/\.pdf$/i, '')
      download(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), `${base}_A4.pdf`)
    } catch (e) {
      setError(`書き出しに失敗しました: ${e instanceof Error ? e.message : e}`)
    } finally {
      setExporting(null)
    }
  }, [pages, settings, fileName, exportDpi])

  return { fileName, pages, settings, setSettings, selected, setSelected, loading, exporting, error, load, setOverrides, exportPdf, exportDpi, setExportDpi }
}

function sig(p: PageState, g: GlobalSettings): string {
  return p.analysis ? JSON.stringify(resolvePage(p.analysis, g, p.overrides)) : ''
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

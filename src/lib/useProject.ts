import { useCallback, useEffect, useRef, useState } from 'react'
import type { GlobalSettings, PageAnalysis, PageOverrides, Rotation } from '../pipeline/types.ts'
import { DEFAULT_SETTINGS } from '../pipeline/defaults.ts'
import { ANALYSIS_DPI, resolvePage } from '../pipeline/process.ts'
import { ProcessorClient } from '../worker/client.ts'
import { rasterToJpegUrl } from './pdf.ts'
import { openSources, type Source } from './source.ts'
import { deliver, prepareDelivery, type ExportAction } from './deliver.ts'

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

/** Finished export, kept so it can be saved or opened again with a fresh tap. */
export interface ExportResult {
  name: string
  file: File
  /** Object URL of the PDF as a download-only blob. */
  url: string
  /** Object URL of the PDF as `application/pdf`, for viewing and printing. */
  viewUrl: string
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
  const [exported, setExported] = useState<ExportResult | null>(null)
  const [exportDpi, setExportDpi] = useState(600)
  const docRef = useRef<Source | null>(null)
  const loadGen = useRef(0)

  const updatePage = useCallback((key: string, patch: Partial<PageState> | ((p: PageState) => Partial<PageState>)) => {
    setPages((ps) => ps.map((p) => (p.key === key ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)))
  }, [])

  /** Opens PDFs and/or images as one document (pages in file-name order). */
  const load = useCallback(async (files: File[]) => {
    const gen = ++loadGen.current
    setError(null)
    setExported((old) => {
      if (old) revokeResult(old)
      return null
    })
    try {
      const c = getClient()
      await c.call({ type: 'reset' })
      await docRef.current?.destroy()
      docRef.current = null
      setPages((old) => {
        for (const p of old) [p.sourceUrl, ...(p.previewUrls ?? [])].forEach((u) => u && URL.revokeObjectURL(u))
        return []
      })
      const doc = await openSources(files)
      docRef.current = doc
      setFileName(doc.name)
      setSelected(0)
      const initial: PageState[] = doc.pages.map((_, i) => ({
        key: `${gen}:${i + 1}`,
        pageNo: i + 1,
        overrides: {},
      }))
      setPages(initial)
      setLoading({ done: 0, total: doc.pages.length })
      for (const p of initial) {
        if (gen !== loadGen.current) return
        try {
          const raster = await doc.pages[p.pageNo - 1].render(ANALYSIS_DPI)
          const sourceUrl = await rasterToJpegUrl(raster, 1600)
          const sourceSize = { width: raster.width, height: raster.height }
          if (gen !== loadGen.current) return
          // Show the page as scanned first; the correction then animates in when the analysis lands.
          updatePage(p.key, { sourceUrl, sourceSize })
          const { analysis } = await c.call({ type: 'analyze', pageKey: p.key, raster }, [raster.gray])
          if (gen !== loadGen.current) return
          updatePage(p.key, { analysis })
        } catch (e) {
          updatePage(p.key, { error: String(e) })
        }
        setLoading({ done: p.pageNo, total: doc.pages.length })
      }
      setLoading(null)
    } catch (e) {
      setError(`ファイルを読み込めませんでした（${e instanceof Error ? e.message : e}）`)
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

  /**
   * Turns a page (auto-detected orientation when `rotation` is undefined). Split and skew
   * depend on the orientation, so the page is analysed again and its manual fixes dropped.
   */
  const rotatePage = useCallback(
    async (key: string, rotation?: Rotation) => {
      try {
        const { analysis } = await getClient().call({ type: 'reanalyze', pageKey: key, rotation })
        updatePage(key, { analysis, overrides: {} })
      } catch (e) {
        updatePage(key, { error: String(e) })
      }
    },
    [updatePage],
  )

  /** Builds the PDF, then downloads, prints or opens it. Call it straight from the click handler (see `prepareDelivery`). */
  const exportPdf = useCallback(async (action: ExportAction) => {
    const doc = docRef.current
    if (!doc) return
    const delivery = prepareDelivery(action)
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
            // Ask for `dpi` of real resolution: the page's size may be off by `dpiScale`.
            const raster = await doc.pages[p.pageNo - 1].render(dpi / page.dpiScale)
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
      const base = (fileName ?? 'score').replace(/ ほか\d+件$/, '').replace(/\.[a-z0-9]+$/i, '')
      const name = `${base}_A4.pdf`
      const bytes = pdf as Uint8Array<ArrayBuffer>
      // octet-stream: with application/pdf, mobile browsers open a viewer instead of saving.
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
      const file = new File([bytes], name, { type: 'application/pdf' })
      const result = { name, url, file, viewUrl: URL.createObjectURL(file) }
      setExported((old) => {
        if (old) revokeResult(old)
        return result
      })
      deliver(delivery, result)
    } catch (e) {
      delivery.cancel()
      setError(`PDFを作成できませんでした（${e instanceof Error ? e.message : e}）`)
    } finally {
      setExporting(null)
    }
  }, [pages, settings, fileName, exportDpi])

  const dismissExported = useCallback(() => setExported(null), [])

  return { fileName, pages, settings, setSettings, selected, setSelected, loading, exporting, exported, dismissExported, error, load, setOverrides, rotatePage, exportPdf, exportDpi, setExportDpi }
}

function sig(p: PageState, g: GlobalSettings): string {
  return p.analysis ? JSON.stringify(resolvePage(p.analysis, g, p.overrides)) : ''
}

function revokeResult(r: ExportResult) {
  URL.revokeObjectURL(r.url)
  URL.revokeObjectURL(r.viewUrl)
}

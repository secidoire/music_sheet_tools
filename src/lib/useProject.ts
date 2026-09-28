import { useCallback, useEffect, useRef, useState } from 'react'
import type { GlobalSettings, PageAnalysis, PageOverrides, Rotation } from '../pipeline/types.ts'
import { DEFAULT_SETTINGS } from '../pipeline/defaults.ts'
import { ANALYSIS_DPI, resolvePage } from '../pipeline/process.ts'
import { poolSize, ProcessorClient, ProcessorPool } from '../worker/client.ts'
import type { EncodedSheet } from '../worker/pdf-builder.ts'
import type { RasterPayload } from '../worker/protocol.ts'
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

let pool: ProcessorPool | null = null
const getPool = () => (pool ??= new ProcessorPool(poolSize()))

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
      const pool = getPool()
      await pool.reset()
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
      // Each worker takes the next page in turn; rasterising (main thread) overlaps their analysis.
      let next = 0
      let done = 0
      await Promise.all(pool.workers.map(async (w) => {
        while (next < initial.length) {
          if (gen !== loadGen.current) return
          const p = initial[next++]
          try {
            const raster = await doc.pages[p.pageNo - 1].render(ANALYSIS_DPI)
            const sourceUrl = await rasterToJpegUrl(raster, 1600)
            const sourceSize = { width: raster.width, height: raster.height }
            if (gen !== loadGen.current) return
            // Show the page as scanned first; the correction then animates in when the analysis lands.
            updatePage(p.key, { sourceUrl, sourceSize })
            pool.assign(p.key, w)
            const { analysis } = await w.call({ type: 'analyze', pageKey: p.key, raster }, [raster.gray])
            if (gen !== loadGen.current) return
            updatePage(p.key, { analysis })
          } catch (e) {
            updatePage(p.key, { error: String(e) })
          }
          setLoading({ done: ++done, total: doc.pages.length })
        }
      }))
      if (gen !== loadGen.current) return
      setLoading(null)
    } catch (e) {
      setError(`ファイルを読み込めませんでした（${e instanceof Error ? e.message : e}）`)
      setLoading(null)
    }
  }, [updatePage])

  // Preview scheduler: one request in flight per worker (each renders the pages it stores), selected page first.
  const inFlight = useRef(new Set<string>())
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (exporting) return
    const pool = getPool()
    const busy = new Set([...inFlight.current].map((k) => pool.of(k)))
    const stale = (p: PageState) => p.analysis && !p.error && sig(p, settings) !== p.previewSig
    const order = [pages[selected], ...pages].filter(Boolean)
    for (const next of order) {
      const w = pool.of(next.key)
      if (!next.analysis || !stale(next) || inFlight.current.has(next.key) || !w || busy.has(w)) continue
      const resolved = resolvePage(next.analysis, settings, next.overrides)
      const s = sig(next, settings)
      busy.add(w)
      inFlight.current.add(next.key)
      w.call({ type: 'preview', pageKey: next.key, page: resolved, outDpi: PREVIEW_DPI })
        .then(({ sheets }) => {
          const urls = sheets.map((b) => URL.createObjectURL(b))
          updatePage(next.key, (p) => {
            p.previewUrls?.forEach((u) => URL.revokeObjectURL(u))
            return { previewUrls: urls, previewSig: s }
          })
        })
        .catch((e) => updatePage(next.key, { error: String(e) }))
        .finally(() => {
          inFlight.current.delete(next.key)
          setTick((t) => t + 1)
        })
    }
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
        const w = getPool().of(key)
        if (!w) throw new Error(`unknown page ${key}`)
        const { analysis } = await w.call({ type: 'reanalyze', pageKey: key, rotation })
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
    const main = getPool().workers[0]
    // Pages are exported in parallel: the pool's first worker plus fresh ones, whose heaps are freed afterwards.
    const extra = Array.from({ length: getPool().workers.length - 1 }, () => new ProcessorClient())
    const lanes = [main, ...extra]
    setExporting({ done: 0, total: pages.filter((p) => p.analysis).length })
    try {
      const jobs = pages.flatMap((p) => (p.analysis ? [{ p, page: resolvePage(p.analysis, settings, p.overrides) }] : []))
      const dpis = EXPORT_FALLBACK.filter((d) => d <= exportDpi)
      const sheets: EncodedSheet[][] = []
      let done = 0
      // Ask for `dpi` of real resolution: the page's size may be off by `dpiScale`.
      const rasterize = (i: number, dpi: number) => doc.pages[jobs[i].p.pageNo - 1].render(dpi / jobs[i].page.dpiScale)
      const exportAt = async (w: ProcessorClient, i: number, dpi: number, raster?: RasterPayload) => {
        raster ??= await rasterize(i, dpi)
        return (await w.call({ type: 'exportPage', raster, page: jobs[i].page, outDpi: dpi }, [raster.gray])).sheets
      }
      // One page is rasterised ahead (main thread) so it works while the workers do;
      // with a single worker this is the only overlap.
      let ahead: { i: number; raster: Promise<Settled<RasterPayload>> } | null = null
      const dropAhead = async () => {
        await ahead?.raster
        ahead = null
      }
      // Working in parallel holds several full-resolution pages at once, which must never cost
      // resolution: after any failure the extra workers are stopped and the read-ahead dropped
      // (freeing their memory), and the remaining pages go through one worker, one at a time.
      const failed: number[] = []
      let next = 0
      await Promise.all(lanes.map(async (w) => {
        while (next < jobs.length && !failed.length) {
          const i = next++
          const mine = ahead?.i === i ? ahead.raster : settle(rasterize(i, dpis[0]))
          if (ahead?.i === i) ahead = null
          if (!ahead && next < jobs.length) ahead = { i: next, raster: settle(rasterize(next, dpis[0])) }
          try {
            const r = await mine
            if (!r.ok) throw r.error
            sheets[i] = await exportAt(w, i, dpis[0], r.value)
            setExporting({ done: ++done, total: jobs.length })
          } catch (e) {
            console.warn(`page ${jobs[i].p.pageNo}: export at ${dpis[0]}dpi failed, retrying alone`, e)
            failed.push(i)
          }
        }
      }))
      extra.forEach((w) => w.terminate())
      await dropAhead()
      const rest = [...failed, ...Array.from({ length: jobs.length - next }, (_, k) => next + k)].sort((a, b) => a - b)
      for (const i of rest) {
        // Very large canvases fail on memory-constrained devices (e.g. iOS); retry at a lower resolution.
        for (const [k, dpi] of dpis.entries()) {
          try {
            sheets[i] = await exportAt(main, i, dpi)
            break
          } catch (e) {
            if (k === dpis.length - 1) throw e
            console.warn(`page ${jobs[i].p.pageNo}: export at ${dpi}dpi failed, retrying lower`, e)
          }
        }
        setExporting({ done: ++done, total: jobs.length })
      }
      const all = sheets.flat()
      const { pdf } = await main.call({ type: 'buildPdf', sheets: all }, all.map((s) => s.data.buffer))
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
      extra.forEach((w) => w.terminate())
      setExporting(null)
    }
  }, [pages, settings, fileName, exportDpi])

  const dismissExported = useCallback(() => setExported(null), [])

  return { fileName, pages, settings, setSettings, selected, setSelected, loading, exporting, exported, dismissExported, error, load, setOverrides, rotatePage, exportPdf, exportDpi, setExportDpi }
}

function sig(p: PageState, g: GlobalSettings): string {
  return p.analysis ? JSON.stringify(resolvePage(p.analysis, g, p.overrides)) : ''
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }

/** Captures the outcome of work started ahead of time, so it is never an unhandled rejection if unused. */
function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  return p.then((value) => ({ ok: true, value }), (error: unknown) => ({ ok: false, error }))
}

function revokeResult(r: ExportResult) {
  URL.revokeObjectURL(r.url)
  URL.revokeObjectURL(r.viewUrl)
}

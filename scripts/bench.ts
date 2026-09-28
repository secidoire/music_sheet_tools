/**
 * Times each stage of the browser's flow on sample PDFs, without the UI, and optionally
 * checks that a change leaves the exported pixels alone:
 *
 *   load     raster      pdf.js render at ANALYSIS_DPI       (browser: main thread)
 *            analyze     staff scale + detection               (worker)
 *   preview  preview     corrected sheets at PREVIEW_DPI       (worker)
 *   export   raster      pdf.js render at the export dpi       (main thread)
 *            gray        RGBA → gray                           (main thread)
 *            process     corrected A4 sheets                   (worker)
 *            encode      1-bit packing + deflate for the PDF   (worker)
 *
 * The browser runs pages on several workers at once, so wall time there is shorter than
 * the sum; the per-stage split shows where the time goes.
 *
 * Usage: npm run bench -- [--filter str] [--pages n] [--dpi 600] [--mode adaptive|levels]
 *                         [--save name] [--compare name]
 *   --save name     keeps the exported sheets in debug-out/bench/<name>/
 *   --compare name  counts pixels that differ from a saved run (as exported: 1-bit in adaptive mode)
 * For a CPU profile: node --import tsx --cpu-prof scripts/bench.ts ...
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import { parseArgs } from 'node:util'
import { listPdfs, openPdf, renderPageRGBA, rgbaToGray } from './node-io.ts'
import { loadCvNode } from './node-cv.ts'
import { analyzePage, ANALYSIS_DPI, isBilevel, renderPage, resolvePage, staffDpiScale } from '../src/pipeline/process.ts'
import { resizeGray } from '../src/pipeline/image.ts'
import { DEFAULT_SETTINGS } from '../src/pipeline/defaults.ts'
import type { GlobalSettings, GrayImage } from '../src/pipeline/types.ts'
import { encodeSheet } from '../src/worker/pdf-builder.ts'

const PREVIEW_DPI = 100 // as in src/lib/useProject.ts

const { values: args } = parseArgs({
  options: {
    filter: { type: 'string', default: '' },
    pages: { type: 'string', default: '99' },
    dpi: { type: 'string', default: '600' },
    mode: { type: 'string', default: DEFAULT_SETTINGS.whiten.mode },
    save: { type: 'string' },
    compare: { type: 'string' },
  },
})
const dpi = Number(args.dpi)
const settings: GlobalSettings = { ...DEFAULT_SETTINGS, whiten: { ...DEFAULT_SETTINGS.whiten, mode: args.mode as GlobalSettings['whiten']['mode'] } }
const saveDir = args.save && `debug-out/bench/${args.save}`
const refDir = args.compare && `debug-out/bench/${args.compare}`
if (saveDir) mkdirSync(saveDir, { recursive: true })
if (refDir && !existsSync(refDir)) throw new Error(`no saved run at ${refDir}`)

const cv = await loadCvNode()
const files = listPdfs('samples').filter((f) => f.normalize('NFC').includes(args.filter!.normalize('NFC')))
const stages = ['load raster', 'analyze', 'preview', 'export raster', 'gray', 'process', 'encode'] as const
const total = Object.fromEntries(stages.map((s) => [s, 0])) as Record<(typeof stages)[number], number>
let pages = 0
let sheets = 0
const diff = { pixels: 0, total: 0, sheets: 0, differing: 0, missing: 0 }

for (const [fi, file] of files.entries()) {
  const doc = await openPdf(file)
  for (let p = 1; p <= Math.min(Number(args.pages), doc.numPages); p++) {
    const time = <T>(stage: (typeof stages)[number], f: () => T): T => {
      const t0 = performance.now()
      const r = f()
      total[stage] += performance.now() - t0
      return r
    }
    const t0 = performance.now()
    let small = rgbaToGray(await renderPageRGBA(doc, p, ANALYSIS_DPI))
    total['load raster'] += performance.now() - t0
    const analysis = time('analyze', () => {
      const s = staffDpiScale(cv, small, ANALYSIS_DPI)
      const real = ANALYSIS_DPI * s
      if (Math.abs(real - ANALYSIS_DPI) > 0.5) small = resizeGray(cv, small, ANALYSIS_DPI / real)
      return analyzePage(cv, small, ANALYSIS_DPI, undefined, s).analysis
    })
    const page = resolvePage(analysis, settings)
    time('preview', () => renderPage(cv, small, ANALYSIS_DPI, page, PREVIEW_DPI))

    const t1 = performance.now()
    const rgba = await renderPageRGBA(doc, p, dpi / page.dpiScale)
    total['export raster'] += performance.now() - t1
    const full = time('gray', () => rgbaToGray(rgba))
    const out = time('process', () => renderPage(cv, full, dpi, page, dpi))
    const t2 = performance.now()
    const bilevel = isBilevel(page)
    for (const s of out) await encodeSheet(s.image, bilevel)
    total.encode += performance.now() - t2

    for (const [k, s] of out.entries()) {
      const name = `f${fi}_p${p}_${k}.bin`
      if (saveDir) writeFileSync(`${saveDir}/${name}`, deflateSync(exported(s.image, bilevel), { level: 1 }))
      if (refDir) compare(`${refDir}/${name}`, exported(s.image, bilevel))
    }
    pages++
    sheets += out.length
  }
  await doc.loadingTask.destroy()
}

/** Pixels as they end up in the PDF: thresholded at 128 when packed to 1 bit. */
function exported(img: GrayImage, bilevel: boolean): Uint8Array {
  const header = new Uint8Array(new Uint32Array([img.width, img.height]).buffer)
  const px = bilevel ? img.data.map((v) => (v >= 128 ? 255 : 0)) : img.data
  const out = new Uint8Array(8 + px.length)
  out.set(header)
  out.set(px, 8)
  return out
}

function compare(path: string, now: Uint8Array) {
  diff.sheets++
  if (!existsSync(path)) return void diff.missing++
  const ref = inflateSync(readFileSync(path))
  if (ref.length !== now.length || Buffer.compare(ref.subarray(0, 8), Buffer.from(now.subarray(0, 8)))) return void diff.differing++
  let n = 0
  for (let i = 8; i < now.length; i++) if (ref[i] !== now[i]) n++
  diff.pixels += n
  if (n) diff.differing++
  diff.total += now.length - 8
}

const ms = (v: number) => `${Math.round(v)}ms`.padStart(9)
console.log(`${files.length} files, ${pages} pages → ${sheets} sheets @${dpi}dpi, ${settings.whiten.mode}`)
console.log('stage           total   per page')
for (const s of stages) console.log(`${s.padEnd(14)}${ms(total[s])}${ms(total[s] / Math.max(1, pages))}`)
if (refDir) {
  const pct = ((diff.pixels / Math.max(1, diff.total)) * 100).toFixed(4)
  console.log(`vs ${args.compare}: ${diff.differing}/${diff.sheets} sheets differ, ${diff.pixels} px (${pct}%)${diff.missing ? `, ${diff.missing} missing` : ''}`)
}

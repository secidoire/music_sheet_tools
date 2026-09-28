/**
 * End-to-end export check without the UI: processes every page of one sample PDF at
 * the given resolution and writes an A4 PDF to debug-out/, plus a 1:1 crop of the
 * first output page for judging sharpness.
 * Usage: npx tsx scripts/export-sample.ts <filter> [dpi]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { listPdfs, openPdf, renderPageRGBA, rgbaToGray, saveImage } from './node-io.ts'
import { loadCvNode } from './node-cv.ts'
import { analyzePage, ANALYSIS_DPI, renderPage, resolvePage, staffDpiScale } from '../src/pipeline/process.ts'
import { resizeGray, crop } from '../src/pipeline/image.ts'
import { DEFAULT_SETTINGS } from '../src/pipeline/defaults.ts'
import { encodeSheet, PdfBuilder } from '../src/worker/pdf-builder.ts'

const [filter, dpiArg] = process.argv.slice(2)
const dpi = Number(dpiArg ?? 600)
const cv = await loadCvNode()
const file = listPdfs('samples').find((f) => f.normalize('NFC').includes(filter.normalize('NFC')))!
const doc = await openPdf(file)
const builder = await PdfBuilder.create()
mkdirSync('debug-out', { recursive: true })
for (let p = 1; p <= doc.numPages; p++) {
  const t0 = performance.now()
  const full = rgbaToGray(await renderPageRGBA(doc, p, dpi))
  const t1 = performance.now()
  const dpiScale = staffDpiScale(cv, full, dpi)
  const { analysis } = analyzePage(cv, resizeGray(cv, full, ANALYSIS_DPI / (dpi * dpiScale)), ANALYSIS_DPI, undefined, dpiScale)
  const sheets = renderPage(cv, full, dpi * dpiScale, resolvePage(analysis, DEFAULT_SETTINGS), dpi)
  for (const s of sheets) builder.addPage(await encodeSheet(s.image, false))
  if (p === 1) {
    const s = sheets[0].image
    await saveImage('debug-out/export-crop.png', crop(s, s.width * 0.1, s.height * 0.1, 1000, 700), 1, 4000)
  }
  console.log(`page ${p}: render ${Math.round(t1 - t0)}ms, process ${Math.round(performance.now() - t1)}ms`)
}
const pdf = await builder.save()
writeFileSync('debug-out/export-sample.pdf', pdf)
console.log(`wrote debug-out/export-sample.pdf (${(pdf.length / 1e6).toFixed(1)} MB)`)
const check = await openPdf('debug-out/export-sample.pdf')
console.log('re-opened:', check.numPages, 'pages')

/**
 * Runs the processing pipeline on the PDFs in samples/ without any UI and writes
 * images for visual inspection to debug-out/pipeline/:
 *
 *   fNN_pM_detect.jpg  analysis overlay: split search window (blue), split line (red),
 *                      Hough segments (green), detected angles (text)
 *   fNN_pM_outK.jpg    corrected A4 output(s)
 *   summary.tsv        one line per page with the detection numbers
 *
 * Usage: npx tsx scripts/debug-pipeline.ts [--filter str] [--pages n] [--no-render] [--dpi n]
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createCanvas } from '@napi-rs/canvas'
import { listPdfs, openPdf, renderPageRGBA, rgbaToGray, saveImage } from './node-io.ts'
import { loadCvNode } from './node-cv.ts'
import { analyzePage, ANALYSIS_DPI, renderPage, resolvePage } from '../src/pipeline/process.ts'
import { DEFAULT_SETTINGS } from '../src/pipeline/defaults.ts'
import type { GrayImage } from '../src/pipeline/types.ts'
import type { AnalysisDebug } from '../src/pipeline/process.ts'

const { values: args } = parseArgs({
  options: {
    filter: { type: 'string', default: '' },
    pages: { type: 'string', default: '99' },
    'no-render': { type: 'boolean', default: false },
    dpi: { type: 'string', default: '150' },
    out: { type: 'string', default: 'debug-out/pipeline' },
  },
})

const cv = await loadCvNode()
const outDir = args.out!
mkdirSync(outDir, { recursive: true })
const summary = `${outDir}/summary.tsv`
writeFileSync(summary, 'id\tpage\tsize\tspread\tsplitX\tmethod\tprofile\though\tgain\tms\tfile\n')

const files = listPdfs('samples').filter((f) => f.normalize('NFC').includes(args.filter!.normalize('NFC')))
for (const [fi, file] of files.entries()) {
  const id = `f${String(fi).padStart(2, '0')}`
  const doc = await openPdf(file)
  const pages = Math.min(doc.numPages, Number(args.pages))
  for (let p = 1; p <= pages; p++) {
    const gray = rgbaToGray(await renderPageRGBA(doc, p, ANALYSIS_DPI))
    const t0 = performance.now()
    const { analysis, debug } = analyzePage(cv, gray)
    const ms = Math.round(performance.now() - t0)
    await saveImage(`${outDir}/${id}_p${p}_detect.jpg`, drawOverlay(gray, debug), 4, 1800)

    const skews = debug.split ? debug.halves : [debug.whole]
    appendFileSync(
      summary,
      [
        id, p, `${gray.width}x${gray.height}`, analysis.isSpread ? 'Y' : '-',
        analysis.splitX.toFixed(3), analysis.splitMethod,
        skews.map((s) => s.profileAngle.toFixed(2)).join('/'),
        skews.map((s) => s.houghAngle.toFixed(2)).join('/'),
        skews.map((s) => s.profileGain.toFixed(2)).join('/'),
        ms, file,
      ].join('\t') + '\n',
    )
    console.log(id, p, analysis.splitMethod, analysis.splitX.toFixed(3), skews.map((s) => `${s.profileAngle}|${s.houghAngle}`).join(' '), `${ms}ms`)

    if (!args['no-render']) {
      const dpi = Number(args.dpi)
      const src = dpi === ANALYSIS_DPI ? gray : rgbaToGray(await renderPageRGBA(doc, p, dpi))
      const resolved = resolvePage(analysis, DEFAULT_SETTINGS)
      const t1 = performance.now()
      const sheets = renderPage(cv, src, dpi, resolved, dpi)
      const rms = Math.round(performance.now() - t1)
      for (const [k, s] of sheets.entries()) await saveImage(`${outDir}/${id}_p${p}_out${k}.jpg`, s.image, 1, 1400)
      console.log(`   rendered ${sheets.length} sheet(s) in ${rms}ms`)
    }
  }
  await doc.loadingTask.destroy()
}

function drawOverlay(gray: GrayImage, d: AnalysisDebug) {
  const { width: w, height: h } = gray
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  const id = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    // Fade the page so the overlay stands out.
    const v = 128 + (gray.data[i] >> 1)
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v
    id.data[i * 4 + 3] = 255
  }
  ctx.putImageData(id, 0, 0)

  const skews = d.split ? d.halves : [d.whole]
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(0,170,0,0.8)'
  for (const s of skews) {
    for (const [x1, y1, x2, y2] of s.segments) {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
  }

  if (d.split) {
    const { x0, ink, brightness } = d.split.debug
    ctx.strokeStyle = 'rgba(0,80,255,0.9)'
    ctx.setLineDash([12, 8])
    ctx.strokeRect(x0, 0, ink.length, h)
    ctx.setLineDash([])
    // Column profiles along the bottom: ink density (magenta) and brightness (orange).
    const plot = (a: Float64Array, max: number, color: string) => {
      ctx.strokeStyle = color
      ctx.beginPath()
      for (let i = 0; i < a.length; i++) ctx.lineTo(x0 + i, h - 10 - (a[i] / max) * h * 0.25)
      ctx.stroke()
    }
    plot(ink, 0.3, 'rgba(220,0,200,0.9)')
    plot(brightness, 255, 'rgba(255,120,0,0.9)')
    ctx.strokeStyle = 'red'
    ctx.lineWidth = 4
    const sx = d.split.x * w
    ctx.beginPath()
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, h)
    ctx.stroke()
  }

  ctx.font = 'bold 28px sans-serif'
  const label = (text: string, x: number, y = 8) => {
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillRect(x, y, ctx.measureText(text).width + 16, 40)
    ctx.fillStyle = 'red'
    ctx.fillText(text, x + 8, y + 30)
  }
  if (d.split) {
    const sx = d.split.x * w
    label(`${d.split.method} x=${d.split.x.toFixed(3)}`, sx + 10, 56)
    skews.forEach((s, i) => label(`P ${s.profileAngle.toFixed(2)}°  H ${s.houghAngle.toFixed(2)}°`, i === 0 ? 20 : sx + 10))
  } else {
    label(`P ${d.whole.profileAngle.toFixed(2)}°  H ${d.whole.houghAngle.toFixed(2)}°  gain ${d.whole.profileGain.toFixed(2)}`, 20)
  }
  return ctx.getImageData(0, 0, w, h)
}

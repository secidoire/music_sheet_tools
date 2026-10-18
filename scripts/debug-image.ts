/**
 * Runs the pipeline on image files (photos) instead of PDFs, for inspection.
 * Usage: npx tsx scripts/debug-image.ts <image...> [--out dir] [--dpi n] [--crop]
 */
import { mkdirSync } from 'node:fs'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { rgbaToGray, saveImage } from './node-io.ts'
import { loadCvNode } from './node-cv.ts'
import { analyzePage, ANALYSIS_DPI, renderPage, resolvePage, staffDpiScale } from '../src/pipeline/process.ts'
import { crop, resizeGray } from '../src/pipeline/image.ts'
import { DEFAULT_SETTINGS } from '../src/pipeline/defaults.ts'
import { assumedLongMm } from '../src/pipeline/paper.ts'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string', default: 'debug-out/photo' }, dpi: { type: 'string', default: '150' }, crop: { type: 'boolean', default: false } },
})
const cv = await loadCvNode()
mkdirSync(args.out!, { recursive: true })
for (const file of positionals) {
  const img = await loadImage(file)
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const full = rgbaToGray(ctx.getImageData(0, 0, img.width, img.height))
  const native = Math.max(full.width, full.height) / (assumedLongMm(full.width, full.height) / 25.4)
  const t0 = performance.now()
  const dpiScale = staffDpiScale(cv, full, native)
  const gray = resizeGray(cv, full, ANALYSIS_DPI / (native * dpiScale))
  const { analysis } = analyzePage(cv, gray, ANALYSIS_DPI, undefined, dpiScale)
  const resolved = resolvePage(analysis, DEFAULT_SETTINGS)
  const sheets = renderPage(cv, full, native * dpiScale, resolved, Number(args.dpi))
  const ms = Math.round(performance.now() - t0)
  const id = basename(file).replace(/\.[^.]+$/, '')
  console.log(id, `${full.width}x${full.height} native ${native.toFixed(0)}dpi scale ${dpiScale.toFixed(2)}`, JSON.stringify(analysis), `${sheets.length} sheets ${ms}ms`)
  for (const [k, s] of sheets.entries()) {
    console.log(`  sheet ${k}: content`, s.content && Object.fromEntries(Object.entries(s.content).map(([a, b]) => [a, Math.round(b as number)])), `staves ${s.staves.length}`)
    await saveImage(`${args.out}/${id}_out${k}.jpg`, s.image, 1, 1400)
    // A 1:1 cut-out for judging edges at the output resolution.
    if (args.crop) await saveImage(`${args.out}/${id}_out${k}_crop.png`, crop(s.image, s.image.width * 0.08, s.image.height * 0.06, 1400, 1000), 1, 4000)
  }
}

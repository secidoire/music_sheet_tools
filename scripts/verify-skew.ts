/**
 * Independent skew measurement for checking the detector: takes two narrow vertical strips
 * (at x0 and x1, fractions of the page width), and finds the vertical offset that best
 * aligns their row-darkness profiles (the staff lines), optionally per horizontal band.
 * Usage: npx tsx scripts/verify-skew.ts <filter> <page> <x0> <x1> [bands]
 */
import { listPdfs, openPdf, renderPageRGBA, rgbaToGray } from './node-io.ts'
const [filter, page, x0f, x1f] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5]]
const f = listPdfs('samples').filter((f) => f.normalize('NFC').includes(filter.normalize('NFC')))[0]
const doc = await openPdf(f)
const g = rgbaToGray(await renderPageRGBA(doc, page, 300))
const strip = (xc: number) => {
  const p = new Float64Array(g.height)
  for (let y = 0; y < g.height; y++) for (let x = xc - 30; x < xc + 30; x++) p[y] += 255 - g.data[y * g.width + x]
  return p
}
const xa = Math.round(x0f * g.width), xb = Math.round(x1f * g.width)
const a = strip(xa), b = strip(xb)
const bands = process.argv[6] ? +process.argv[6] : 1
for (let k = 0; k < bands; k++) {
const ya = 200 + Math.round((g.height - 400) * k / bands), yb = 200 + Math.round((g.height - 400) * (k + 1) / bands)
let best = 0, bs = -1
for (let d = -150; d <= 150; d++) {
  let s = 0
  for (let y = ya; y < yb; y++) s += a[y] * b[y + d]
  if (s > bs) { bs = s; best = d }
}
console.log(`band ${k}: ` + `offset ${best}px over ${xb - xa}px → ${(Math.atan2(best, xb - xa) * 180 / Math.PI).toFixed(3)}°  (±${(Math.atan2(1, xb - xa) * 180 / Math.PI).toFixed(3)})`)
}

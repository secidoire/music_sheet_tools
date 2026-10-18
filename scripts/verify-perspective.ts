/**
 * Checks the perspective correction on known geometry, without any copyrighted material:
 * the bundled sample (public/sample.jpg, a flat page) is photographed by a simulated pinhole
 * camera from several angles, the fit runs on each photo, and a rectangle on the original
 * page is followed through the camera and the fix to see how far from a rectangle it ends
 * up (convergence and shear left over, in degrees; aspect ratio error). The flat case must
 * come back as "flat" (null): scans are not to be touched.
 *
 * Usage: npx tsx scripts/verify-perspective.ts [--save]   (--save writes the photos and results to debug-out/perspective/)
 */
import { mkdirSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { rgbaToGray, saveImage } from './node-io.ts'
import { loadCvNode } from './node-cv.ts'
import { ANALYSIS_DPI, staffDpiScale } from '../src/pipeline/process.ts'
import { resizeGray } from '../src/pipeline/image.ts'
import { detectStaves } from '../src/pipeline/staff.ts'
import { fitPerspective, homography, rectify, warpPerspective } from '../src/pipeline/perspective.ts'

const save = process.argv.includes('--save')
if (save) mkdirSync('debug-out/perspective', { recursive: true })
const cv = await loadCvNode()
const img = await loadImage('public/sample.jpg')
const c = createCanvas(img.width, img.height)
const ctx = c.getContext('2d')
ctx.drawImage(img, 0, 0)
const src = rgbaToGray(ctx.getImageData(0, 0, img.width, img.height))
const W = src.width, H = src.height
// Photos from a pinhole camera: the page (W × H, centred) turned by tilt about the x and y
// axes and rolled about z, at a distance that fills ~85% of the frame; focal length 0.8 ×
// the image diagonal (a phone's wide camera), principal point at the image centre.
const camera = (tiltX: number, tiltY: number, roll: number): [number, number][] => {
  const f = 0.8 * Math.hypot(W, H)
  const D = f / 0.85
  const r = (d: number) => (d * Math.PI) / 180
  const [ax, ay, az] = [r(tiltX), r(tiltY), r(roll)]
  return ([[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]] as [number, number][]).map(([X, Y]) => {
    // Rz, then Ry, then Rx.
    let x = X * Math.cos(az) - Y * Math.sin(az)
    let y = X * Math.sin(az) + Y * Math.cos(az)
    let z = 0
    ;[x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)]
    ;[y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)]
    z += D
    return [(f * x) / z + W / 2, (f * y) / z + H / 2]
  })
}
const cases: Record<string, [number, number][]> = {
  tiltX15: camera(15, 0, 0),
  tiltY15: camera(0, 15, 0),
  tiltX10Y12roll3: camera(10, 12, 3),
  tiltX20Ym8: camera(20, -8, -2),
  flat: camera(0, 0, 0),
}
const apply = (m: number[], [x, y]: [number, number]): [number, number] => {
  const z = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z]
}
const ang = (p: [number, number], q: [number, number]) => Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI
for (const [name, dst] of Object.entries(cases)) {
  const pageRect: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]]
  const toPhoto = homography(pageRect, dst)
  const photo = warpPerspective(src, homography(dst, pageRect), 0, 0, W, H)
  const native = 150 // sample is 150dpi A4
  const dpiScale = staffDpiScale(cv, photo, native)
  const gray = resizeGray(cv, photo, ANALYSIS_DPI / (native * dpiScale))
  const k = gray.width / W
  const staves = detectStaves(cv, gray, ANALYSIS_DPI).staves
  const t0 = performance.now()
  const fix = fitPerspective(cv, gray, staves, { x: 0, width: gray.width }, ANALYSIS_DPI, (m) => console.log('   ', m))
  console.log(name, `${staves.length} staves, fit ${(performance.now() - t0).toFixed(0)}ms`, fix ? '' : '→ no correction')
  if (!fix) {
    if (name === 'flat') console.log('   ok: a flat page is left alone')
    else process.exitCode = 1
    continue
  }
  if (name === 'flat') {
    console.log('   FAIL: a flat page would be warped')
    process.exitCode = 1
  }
  // A rectangle on the original page → photo → corrected: should be a rectangle again.
  const px = (p: [number, number]): [number, number] => [p[0] * gray.width, p[1] * gray.height]
  const r = fix.rect
  const fwd = homography(fix.quad.map(px), [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]].map(px as never))
  const block: [number, number][] = [[130, 260], [W - 130, 260], [W - 130, 260 + 9 * 140 + 44], [130, 260 + 9 * 140 + 44]]
  const seen = block.map((p) => apply(toPhoto, p)).map(([x, y]) => apply(fwd, [x * k, y * k]))
  const top = ang(seen[0], seen[1]), bottom = ang(seen[3], seen[2]), left = ang(seen[0], seen[3]), right = ang(seen[1], seen[2])
  const w = Math.hypot(seen[1][0] - seen[0][0], seen[1][1] - seen[0][1]), h = Math.hypot(seen[3][0] - seen[0][0], seen[3][1] - seen[0][1])
  const trueAspect = (W - 260) / (9 * 140 + 44)
  console.log(`   residual: converge H ${Math.abs(top - bottom).toFixed(2)}° V ${Math.abs(left - right).toFixed(2)}° shear ${Math.abs((left + right) / 2 - (top + bottom) / 2 - 90).toFixed(2)}° rotation ${((top + bottom) / 2).toFixed(2)}° aspect ${(w / h).toFixed(4)} (true ${trueAspect.toFixed(4)}, ${(((w / h) / trueAspect - 1) * 100).toFixed(1)}%)`)
  if (save) {
    await saveImage(`debug-out/perspective/${name}_photo.jpg`, gray, 1, 1000)
    await saveImage(`debug-out/perspective/${name}_fixed.jpg`, rectify(gray, fix, 0, gray.width), 1, 1000)
  }
}

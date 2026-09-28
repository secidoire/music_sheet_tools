// Copies runtime assets that are loaded by URL (not bundled) into public/vendor/,
// so Vite serves them under the configured `base` in dev and copies them into dist/.
//   opencv.js, opencv_js.wasm  OpenCV.js built by scripts/build-opencv.sh, loaded by the worker
//   pdfjs/wasm/          JBIG2 / JPEG2000 / ICC decoders used for scanned PDFs
//   pdfjs/cmaps/         CJK character maps
//   pdfjs/standard_fonts/
import { cpSync, mkdirSync, rmSync } from 'node:fs'

const out = 'public/vendor'
rmSync(out, { recursive: true, force: true })
mkdirSync(`${out}/pdfjs`, { recursive: true })
for (const f of ['opencv.js', 'opencv_js.wasm']) cpSync(`vendor/opencv/${f}`, `${out}/${f}`)
for (const dir of ['wasm', 'cmaps', 'standard_fonts']) {
  cpSync(`node_modules/pdfjs-dist/${dir}`, `${out}/pdfjs/${dir}`, { recursive: true })
}
console.log('vendor assets copied to', out)

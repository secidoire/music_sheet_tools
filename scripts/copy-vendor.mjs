// Copies runtime assets that are loaded by URL (not bundled) into public/vendor/,
// so Vite serves them under the configured `base` in dev and copies them into dist/.
//   opencv.js            OpenCV.js (single file, wasm embedded), loaded by the worker
//   pdfjs/wasm/          JBIG2 / JPEG2000 / ICC decoders used for scanned PDFs
//   pdfjs/cmaps/         CJK character maps
//   pdfjs/standard_fonts/
import { cpSync, mkdirSync, rmSync } from 'node:fs'

const out = 'public/vendor'
rmSync(out, { recursive: true, force: true })
mkdirSync(`${out}/pdfjs`, { recursive: true })
cpSync('node_modules/@techstark/opencv-js/dist/opencv.js', `${out}/opencv.js`)
for (const dir of ['wasm', 'cmaps', 'standard_fonts']) {
  cpSync(`node_modules/pdfjs-dist/${dir}`, `${out}/pdfjs/${dir}`, { recursive: true })
}
console.log('vendor assets copied to', out)

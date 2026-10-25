// Temporary compatibility patch for PDF.js 6.4.299. Its operator-stream error handler
// marks the stream complete and wakes rendering before rejecting the error, which can
// resolve a failed render as a blank/partial success (including maxImageSize errors).
// Keep the version and exact source guard: review/remove this patch on every upgrade.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../node_modules/pdfjs-dist/', import.meta.url)
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
if (version !== '6.4.299') throw new Error(`Review the PDF.js error-propagation patch before using ${version}`)

const path = new URL('legacy/build/pdf.mjs', root)
const before = `        if (intentState.operatorList) {
          intentState.operatorList.lastChunk = true;
          for (const internalRenderTask of intentState.renderTasks) {
            internalRenderTask.operatorListChanged();
          }
          this.#tryCleanup();
        }
        if (intentState.displayReadyCapability) {`
const after = `        if (intentState.operatorList) {
          // music-sheet-tools: fail closed on operator-stream errors.
          intentState.opListReadCapability?.reject(reason);
          intentState.operatorList.lastChunk = true;
          for (const internalRenderTask of intentState.renderTasks) {
            if (typeof internalRenderTask.cancel === "function") {
              internalRenderTask.cancel(reason);
            } else {
              intentState.renderTasks.delete(internalRenderTask);
            }
          }
          this.#tryCleanup();
        }
        if (intentState.displayReadyCapability) {`

const source = readFileSync(path, 'utf8')
const appliedCount = source.split(after).length - 1
if (appliedCount > 1) throw new Error('PDF.js patch appears more than once')
if (appliedCount === 0) {
  if (source.split(before).length !== 2) throw new Error('PDF.js patch source does not match exactly once')
  writeFileSync(path, source.replace(before, after))
  console.log('Applied PDF.js operator-stream error-propagation patch')
}

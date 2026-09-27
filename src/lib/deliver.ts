import type { ExportResult } from './useProject.ts'

export type ExportAction = 'download' | 'print' | 'open'

/** What was set up at click time for an export that finishes later. */
export interface Delivery {
  action: ExportAction
  /** Tab opened during the click, while popups are still allowed. */
  tab: Window | null
  cancel: () => void
}

/**
 * Safari (macOS and iOS) doesn't reliably print a PDF from an iframe, so it gets the PDF in
 * a new tab and prints from its viewer.
 */
const isSafari = () => /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent)

/**
 * Must run synchronously inside the click handler: browsers block `window.open` once the
 * export's asynchronous work has started.
 */
export function prepareDelivery(action: ExportAction): Delivery {
  let tab: Window | null = null
  if (action === 'open' || (action === 'print' && isSafari())) {
    tab = window.open('', '_blank')
    if (tab) {
      tab.document.title = 'PDFを作成中'
      tab.document.body.style.cssText = 'font-family:system-ui,sans-serif;color:#74706a;display:grid;place-items:center;height:100vh;margin:0'
      tab.document.body.textContent = 'PDFを作成しています…'
    }
  }
  return { action, tab, cancel: () => tab?.close() }
}

export function deliver({ action, tab }: Delivery, r: ExportResult) {
  if (tab) {
    tab.location.href = r.viewUrl
  } else if (action === 'print') {
    printPdf(r.viewUrl)
  } else if (action === 'download') {
    saveUrl(r.url, r.name)
  }
  // `open` with a blocked popup: the result bar offers the link instead.
}

/**
 * Starts a download of `url`. Browsers may ignore this when it runs long after the click
 * that started the export (iOS Safari), which is why the result also stays on screen
 * with its own download link.
 */
export function saveUrl(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
}

let printFrame: HTMLIFrameElement | null = null

/** Opens the print dialog for a PDF without leaving the page. Falls back to a new tab. */
export function printPdf(url: string) {
  printFrame?.remove()
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.onload = () => {
    // The PDF viewer inside the frame needs a moment after load before it can print.
    setTimeout(() => {
      try {
        frame.contentWindow!.focus()
        frame.contentWindow!.print()
      } catch {
        window.open(url, '_blank')
      }
    }, 300)
  }
  frame.src = url
  document.body.append(frame)
  printFrame = frame
}

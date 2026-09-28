import type { RequestMessage, ResponseMessage, WorkerRequest, WorkerResponses } from './protocol.ts'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

/** Promise wrapper around the processing worker. Requests are executed in order. */
export class ProcessorClient {
  private worker = new Worker(new URL('./processor.worker.ts', import.meta.url), { type: 'module' })
  private nextId = 1
  private pending = new Map<number, Pending>()

  constructor() {
    this.worker.onmessage = (e: MessageEvent<ResponseMessage>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.result)
      else p.reject(new Error(e.data.error))
    }
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'worker error')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    }
  }

  call<T extends WorkerRequest>(req: T, transfer: Transferable[] = []): Promise<WorkerResponses[T['type']]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker.postMessage({ ...req, id } satisfies RequestMessage, transfer)
    })
  }

  /** Stops the worker and frees its memory (an OpenCV heap never shrinks while it lives). */
  terminate() {
    this.worker.terminate()
    const err = new Error('worker terminated')
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }
}

/**
 * Processing workers that work on different pages at once. A page's stored source
 * stays in the worker that analysed it, so later requests for it go to that worker.
 */
export class ProcessorPool {
  readonly workers: ProcessorClient[]
  private owners = new Map<string, ProcessorClient>()

  constructor(size: number) {
    this.workers = Array.from({ length: size }, () => new ProcessorClient())
  }

  /** Worker that stores `pageKey`'s source. */
  of(pageKey: string): ProcessorClient | undefined {
    return this.owners.get(pageKey)
  }

  assign(pageKey: string, w: ProcessorClient) {
    this.owners.set(pageKey, w)
  }

  async reset() {
    this.owners.clear()
    await Promise.all(this.workers.map((w) => w.call({ type: 'reset' })))
  }
}

/**
 * How many pages to process at once. Every worker holds its own OpenCV heap and a
 * full-resolution page while exporting (~0.55GB each at 600dpi), and a tab that runs out of
 * memory is killed outright, so memory-constrained devices get one: iOS/iPadOS kill tabs
 * that use a lot of memory. A fourth worker only where the browser reports 8GB or more
 * (Chrome/Edge report deviceMemory, capped at 8; Safari and Firefox don't report it).
 */
export function poolSize(): number {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (ios || (memory !== undefined && memory < 4)) return 1
  const cores = navigator.hardwareConcurrency || 2
  const cap = /Android|Mobi/.test(navigator.userAgent) ? 2 : memory !== undefined && memory >= 8 ? 4 : 3
  return Math.max(2, Math.min(cap, cores - 1))
}

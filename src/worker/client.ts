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
}

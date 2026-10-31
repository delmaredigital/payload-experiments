import type { DocId } from '../types/contracts.js'
import type { SummaryResponse } from '../types/endpoints.js'
import type { createApi } from './api.js'

export type SummaryEntry = SummaryResponse[DocId]
type Api = Pick<ReturnType<typeof createApi>, 'summary'>
type Pending = { id: DocId; resolve: (value: SummaryEntry | null) => void }
let pending: Pending[] = []

/** All list cells mounted in this tick share a request, even with separate useApi instances. */
export function requestSummary(api: Api, id: DocId): Promise<SummaryEntry | null> {
  return new Promise(resolve => {
    pending.push({ id, resolve })
    if (pending.length !== 1) return
    queueMicrotask(() => {
      const batch = pending
      pending = []
      const ids = [...new Map(batch.map(item => [String(item.id), item.id])).values()]
      for (let offset = 0; offset < ids.length; offset += 100) {
        const chunk = ids.slice(offset, offset + 100)
        const keys = new Set(chunk.map(String))
        const callers = batch.filter(item => keys.has(String(item.id)))
        void (async () => {
          try {
            const result = await api.summary(chunk)
            for (const caller of callers) caller.resolve(result.ok ? result.data?.[caller.id] ?? null : null)
          } catch { for (const caller of callers) caller.resolve(null) }
        })()
      }
    })
  })
}

import type { DocId } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'

type Placements = PreflightResult['placements']
type Entry = { consumers: number; controller: AbortController; promise: Promise<Placements | undefined> }
const cache = new Map<string, Entry>()

/** One optional placement read per test while its blocks are mounted; never refreshed on tab return. */
export function acquirePlacements(api: string, id: DocId): { promise: Entry['promise']; release: () => void } {
  const key = JSON.stringify([api, String(id)])
  let entry = cache.get(key)
  if (!entry) {
    const controller = new AbortController()
    const promise = (async () => {
      try {
        const response = await fetch(`${api}/xp/experiments/${encodeURIComponent(id)}/preflight`, {
          credentials: 'include', cache: 'no-store', signal: controller.signal,
        })
        if (!response.ok) return
        const data = await response.json() as PreflightResult
        return Array.isArray(data.placements) ? data.placements : undefined
      } catch { return undefined }
    })()
    entry = { consumers: 0, controller, promise }
    cache.set(key, entry)
  }
  const current = entry
  current.consumers++
  let released = false
  return { promise: current.promise, release: () => {
    if (released) return
    released = true
    if (--current.consumers === 0) {
      current.controller.abort()
      if (cache.get(key) === current) cache.delete(key)
    }
  } }
}

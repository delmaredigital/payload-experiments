import type { DocId } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'

type Placements = PreflightResult['placements']
type Entry = { controller: AbortController; promise: Promise<Placements | undefined>; pending: boolean }
const cache = new Map<string, Entry>()
const consumers = new Map<string, Set<(placements: Placements | undefined) => void>>()
const keyFor = (api: string, id: DocId) => JSON.stringify([api, String(id)])

function read(api: string, id: DocId, fresh: boolean): Entry {
  const key = keyFor(api, id)
  const cached = cache.get(key)
  if (cached && (!fresh || cached.pending)) return cached
  const controller = new AbortController()
  const entry: Entry = { controller, pending: true, promise: undefined! }
  cache.set(key, entry)
  for (const notify of consumers.get(key) ?? []) notify(undefined)
  entry.promise = (async () => {
    try {
      const response = await fetch(`${api}/xp/experiments/${encodeURIComponent(id)}/preflight`, {
        credentials: 'include', cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) return
      const data = await response.json() as PreflightResult
      return Array.isArray(data.placements) ? data.placements : undefined
    } catch { return undefined }
  })().then(placements => {
    entry.pending = false
    if (cache.get(key) === entry) {
      if (placements === undefined) cache.delete(key)
      for (const notify of consumers.get(key) ?? []) notify(placements)
    }
    return placements
  })
  return entry
}

/** Share mounted reads, but destructive actions always bypass settled cached knowledge. */
export function refreshPlacements(api: string, id: DocId) { return read(api, id, true).promise }

/** Reuse the surface's successful preflight, without another editor request. */
export function publishPlacements(api: string, id: DocId, placements: Placements | undefined) {
  const key = keyFor(api, id)
  cache.get(key)?.controller.abort()
  if (placements === undefined) cache.delete(key)
  else cache.set(key, { controller: new AbortController(), promise: Promise.resolve(placements), pending: false })
  for (const notify of consumers.get(key) ?? []) notify(placements)
}

export function invalidatePlacements(api: string, id: DocId) {
  const key = keyFor(api, id)
  cache.get(key)?.controller.abort()
  cache.delete(key)
  for (const notify of consumers.get(key) ?? []) notify(undefined)
  if (consumers.get(key)?.size) void read(api, id, true).promise
}

export function acquirePlacements(api: string, id: DocId, notify: (placements: Placements | undefined) => void, fresh = false): () => void {
  const key = keyFor(api, id)
  let listeners = new Set<(placements: Placements | undefined) => void>()
  listeners = consumers.get(key) ?? listeners
  consumers.set(key, listeners)
  listeners.add(notify)
  const entry = read(api, id, fresh)
  let active = true
  void entry.promise.then(value => { if (active && cache.get(key) === entry) notify(value) })
  return () => {
    active = false
    listeners.delete(notify)
    if (!listeners.size) {
      consumers.delete(key)
      cache.get(key)?.controller.abort()
      cache.delete(key)
    }
  }
}

import type { DocId } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'

type Placements = PreflightResult['placements']
type Entry = { controller: AbortController; promise: Promise<Placements | undefined>; pending: boolean; preflight?: PreflightResult }
const cache = new Map<string, Entry>()
const preflights = new Map<string, PreflightResult>()
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
      entry.preflight = data
      if (data.checks?.some(check => !check.ok && check.code === 'no-placements' && check.detail !== undefined)) return
      return Array.isArray(data.placements) ? data.placements : undefined
    } catch { return undefined }
  })().then(placements => {
    entry.pending = false
    if (cache.get(key) === entry) {
      if (entry.preflight) preflights.set(key, entry.preflight)
      else preflights.delete(key)
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
export function publishPlacements(api: string, id: DocId, placements: Placements | undefined, preflight?: PreflightResult) {
  const key = keyFor(api, id)
  cache.get(key)?.controller.abort()
  if (preflight) preflights.set(key, preflight)
  else preflights.delete(key)
  if (placements === undefined) cache.delete(key)
  else cache.set(key, { controller: new AbortController(), promise: Promise.resolve(placements), pending: false, preflight })
  for (const notify of consumers.get(key) ?? []) notify(placements)
}

export function invalidatePlacements(api: string, id: DocId) {
  const key = keyFor(api, id)
  cache.get(key)?.controller.abort()
  cache.delete(key)
  preflights.delete(key)
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
      preflights.delete(key)
      cache.get(key)?.controller.abort()
      cache.delete(key)
    }
  }
}

/** Current readiness shares the same request and lifetime as placements. */
export function cachedPreflight(api: string, id: DocId) { return preflights.get(keyFor(api, id)) }

export function placementsPending(api: string, id: DocId) { return cache.get(keyFor(api, id))?.pending === true }

// One timer per editor document, shared by chrome, sidebar and detached drawers.
// Watching is opt-in: only a rendered save/publish notice owns a subscription.
type NoticeSession = {
  requests: Map<string, { api: string; id: DocId; count: number }>
  timer?: ReturnType<typeof setInterval>
  visibility: () => void
}
const notices = new WeakMap<Document, NoticeSession>()
export function watchPlacementNotice(api: string, id: DocId, doc: Document): () => void {
  let session = notices.get(doc)
  if (!session) {
    const created: NoticeSession = { requests: new Map(), visibility: () => {} }
    created.visibility = () => {
      if (created.timer !== undefined) { clearInterval(created.timer); created.timer = undefined }
      if (doc.visibilityState !== 'visible' || !created.requests.size) return
      created.timer = setInterval(() => {
        if (doc.visibilityState !== 'visible') return
        for (const request of [...created.requests.values()]) void refreshPlacements(request.api, request.id)
      }, 4_000)
    }
    session = created
    notices.set(doc, session)
    doc.addEventListener('visibilitychange', created.visibility)
  }
  const current = session
  const key = keyFor(api, id)
  const request = current.requests.get(key) ?? { api, id, count: 0 }
  request.count++
  current.requests.set(key, request)
  if (current.timer === undefined) current.visibility()
  let active = true
  return () => {
    if (!active) return
    active = false
    if (--request.count === 0) current.requests.delete(key)
    if (!current.requests.size) {
      if (current.timer !== undefined) clearInterval(current.timer)
      doc.removeEventListener('visibilitychange', current.visibility)
      notices.delete(doc)
    }
  }
}

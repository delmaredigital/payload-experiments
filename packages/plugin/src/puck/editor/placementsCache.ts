import type { DocId } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'

type Placements = PreflightResult['placements']
type Entry = { controller: AbortController; promise: Promise<Placements | undefined>; pending: boolean; preflight?: PreflightResult; response?: Response }
const cache = new Map<string, Entry>()
const latest = new Map<string, Entry>()
const consumers = new Map<string, Set<(placements: Placements | undefined) => void>>()
const keyFor = (api: string, id: DocId) => JSON.stringify([api, String(id)])

function read(api: string, id: DocId, fresh: boolean): Entry {
  const key = keyFor(api, id)
  const cached = cache.get(key)
  if (cached && (!fresh || cached.pending)) return cached
  const controller = new AbortController()
  const entry: Entry = { controller, pending: true, promise: undefined! }
  cache.set(key, entry)
  latest.set(key, entry)
  for (const notify of consumers.get(key) ?? []) notify(undefined)
  entry.promise = (async () => {
    try {
      const response = await fetch(`${api}/xp/experiments/${encodeURIComponent(id)}/preflight`, {
        credentials: 'include', cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) { entry.response = response; return }
      const data = await response.json() as PreflightResult
      entry.preflight = data
      if (data.checks?.some(check => !check.ok && check.code === 'no-placements' && check.detail !== undefined)) return
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

export function invalidatePlacements(api: string, id: DocId) {
  const key = keyFor(api, id)
  cache.get(key)?.controller.abort()
  cache.delete(key)
  latest.delete(key)
  for (const notify of consumers.get(key) ?? []) notify(undefined)
  if (consumers.get(key)?.size) void read(api, id, true).promise
}

/** Listen without starting a request; the drawer already owns its initial preflight. */
export function subscribePlacements(api: string, id: DocId, notify: (placements: Placements | undefined) => void): () => void {
  const key = keyFor(api, id)
  const listeners = consumers.get(key) ?? new Set<(placements: Placements | undefined) => void>()
  consumers.set(key, listeners)
  listeners.add(notify)
  let listening = true
  return () => {
    if (!listening) return
    listening = false
    listeners.delete(notify)
    if (!listeners.size && consumers.get(key) === listeners) {
      consumers.delete(key)
      latest.delete(key)
      cache.get(key)?.controller.abort()
      cache.delete(key)
    }
  }
}
export function acquirePlacements(api: string, id: DocId, notify: (placements: Placements | undefined) => void, fresh = false): () => void {
  const release = subscribePlacements(api, id, notify)
  const key = keyFor(api, id)
  const entry = read(api, id, fresh)
  let active = true
  void entry.promise.then(value => { if (active && cache.get(key) === entry) notify(value) })
  return () => { active = false; release() }
}

/** Drawer preflight uses this same producer and follows a superseding post-write read. */
export async function readEditorPreflight(api: string, id: DocId, signal: AbortSignal, supersede = false): Promise<Response> {
  if (signal.aborted) return new Response(null, { status: 503 })
  const release = subscribePlacements(api, id, () => {})
  signal.addEventListener('abort', release, { once: true })
  try {
    if (supersede) invalidatePlacements(api, id)
    let entry = read(api, id, true)
    while (!signal.aborted) {
      await entry.promise
      if (signal.aborted) return new Response(null, { status: 503 })
      const current = latest.get(keyFor(api, id))
      if (current && current !== entry) { entry = current; continue }
      return entry.preflight ? Response.json(entry.preflight) : entry.response?.clone() ?? new Response(null, { status: 503 })
    }
    return new Response(null, { status: 503 })
  } finally { signal.removeEventListener('abort', release); release() }
}

/** Current readiness shares the same request and lifetime as placements. */
export function cachedPreflight(api: string, id: DocId) { return latest.get(keyFor(api, id))?.preflight }

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

import type { DocId } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { PLACEMENT_FAILURE_COPY } from '../../testSurface/copy/readiness.js'

type Placements = PreflightResult['placements']
type Entry = { controller: AbortController; promise: Promise<Placements | undefined>; pending: boolean; startedAt: number; failures: number; value?: Placements; previousPreflight?: PreflightResult; preflight?: PreflightResult; response?: Response }
const cache = new Map<string, Entry>()
const latest = new Map<string, Entry>()
type Consumer = (placements: Placements | undefined) => void
type Consumers = { listeners: Set<Consumer>; removeListener: (notify: Consumer) => void }
const consumers = new Map<string, Consumers>()
const keyFor = (api: string, id: DocId) => JSON.stringify([api, String(id)])

function read(api: string, id: DocId, fresh: boolean): Entry {
  const key = keyFor(api, id)
  const cached = cache.get(key)
  if (cached && (!fresh || cached.pending)) return cached
  const controller = new AbortController()
  const previous = latest.get(key)
  const entry: Entry = { controller, pending: true, startedAt: Date.now(), failures: previous?.failures ?? 0, value: previous?.failures ? undefined : previous?.value, previousPreflight: previous?.failures ? undefined : previous?.preflight ?? previous?.previousPreflight, promise: undefined! }
  cache.set(key, entry)
  latest.set(key, entry)
  for (const notify of consumers.get(key)?.listeners ?? []) notify(entry.value)
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
    entry.failures = placements === undefined ? entry.failures + 1 : 0
    if (placements !== undefined) entry.value = placements
    if (cache.get(key) === entry) {
      if (placements === undefined) cache.delete(key)
      for (const notify of consumers.get(key)?.listeners ?? []) notify(placements)
    }
    return placements
  })
  return entry
}

/** Share mounted reads, but destructive actions always bypass settled cached knowledge. */
export function refreshPlacements(api: string, id: DocId) { return read(api, id, true).promise }

/** Focus storms share the last attempt (including polling), at most once per ten seconds. */
export function focusPlacements(api: string, id: DocId) {
  const previous = latest.get(keyFor(api, id))
  if (previous && Date.now() - previous.startedAt < 10_000) return previous.promise
  return read(api, id, true).promise
}

export function invalidatePlacements(api: string, id: DocId) {
  const key = keyFor(api, id)
  cache.get(key)?.controller.abort()
  cache.delete(key)
  if (consumers.get(key)?.listeners.size) void read(api, id, true).promise
  else latest.delete(key)
}

/** Listen without starting a request; the drawer already owns its initial preflight. */
export function subscribePlacements(api: string, id: DocId, notify: (placements: Placements | undefined) => void): () => void {
  const key = keyFor(api, id)
  let group = consumers.get(key)
  if (!group) {
    const listeners = new Set<Consumer>()
    group = { listeners, removeListener: notify => { listeners.delete(notify) } }
    consumers.set(key, group)
  }
  const current = group
  current.listeners.add(notify)
  let listening = true
  return () => {
    if (!listening) return
    listening = false
    current.removeListener(notify)
    if (!current.listeners.size && consumers.get(key) === current) {
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
  if (entry.value !== undefined) notify(entry.value)
  let active = true
  void entry.promise.then(() => { if (active && cache.get(key) === entry) notify(entry.value) })
  return () => { active = false; release() }
}

/** Drawer preflight uses this same producer and follows a superseding post-write read. */
export async function readEditorPreflight(api: string, id: DocId, signal: AbortSignal, supersede = false): Promise<Response> {
  if (signal.aborted) return new Response(null, { status: 503 })
  const release = subscribePlacements(api, id, () => {})
  signal.addEventListener('abort', release, { once: true })
  try {
    if (supersede) invalidatePlacements(api, id)
    const previous = latest.get(keyFor(api, id))
    let entry = previous && Date.now() - previous.startedAt < 10_000 ? previous : read(api, id, true)
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
export function cachedPreflight(api: string, id: DocId) {
  const entry = latest.get(keyFor(api, id))
  return entry?.preflight ?? (entry?.pending ? entry.previousPreflight : undefined)
}

export function placementsPending(api: string, id: DocId) { return cache.get(keyFor(api, id))?.pending === true }

/** HTTP access refusals and placement-discovery access refusals share one calm state. */
export function placementReadError(api: string, id: DocId): string | undefined {
  const entry = latest.get(keyFor(api, id))
  if (!entry) return
  const check = entry.preflight?.checks?.find(check => !check.ok && check.code === 'no-placements' && check.detail !== undefined)
  if (entry.response?.status === 401 || entry.response?.status === 403 || check?.detail === 'forbidden') return PLACEMENT_FAILURE_COPY.forbidden
  if (entry.failures) return PLACEMENT_FAILURE_COPY['placements-failed']
}

// One timer per editor document, shared by chrome, sidebar and detached drawers.
// Save/publish notices poll every four seconds; failures back off until recovery.
type NoticeRequest = { api: string; id: DocId; subscribers: number; nextAt: number; pending: boolean; release: () => void }
type NoticeSession = {
  requests: Map<string, NoticeRequest>
  removeRequest: (key: string) => void
  timer?: ReturnType<typeof setTimeout>
  visibility: () => void
  schedule: () => void
}
const notices = new WeakMap<Document, NoticeSession>()
const noticeDelay = (api: string, id: DocId) => {
  const failures = latest.get(keyFor(api, id))?.failures ?? 0
  return [4_000, 8_000, 16_000, 30_000][Math.min(Math.max(0, failures - 1), 3)]!
}
export function watchPlacementNotice(api: string, id: DocId, doc: Document): () => void {
  let session = notices.get(doc)
  if (!session) {
    const requests = new Map<string, NoticeRequest>()
    const created: NoticeSession = { requests, removeRequest: key => { requests.delete(key) }, visibility: () => {}, schedule: () => {} }
    created.schedule = () => {
      if (created.timer !== undefined) { clearTimeout(created.timer); created.timer = undefined }
      const eligible = [...created.requests.values()].filter(request => !request.pending && placementReadError(request.api, request.id) !== PLACEMENT_FAILURE_COPY.forbidden)
      if (doc.visibilityState !== 'visible' || !eligible.length) return
      created.timer = setTimeout(() => {
        created.timer = undefined
        if (doc.visibilityState !== 'visible') return
        const due = eligible.filter(request => created.requests.get(keyFor(request.api, request.id)) === request && request.nextAt <= Date.now())
        for (const request of due) {
          request.pending = true
          void refreshPlacements(request.api, request.id).then(() => {
            request.pending = false
            request.nextAt = Date.now() + noticeDelay(request.api, request.id)
            if (notices.get(doc) === created) created.schedule()
          })
        }
        created.schedule()
      }, Math.max(0, Math.min(...eligible.map(request => request.nextAt)) - Date.now()))
    }
    created.visibility = () => {
      for (const request of created.requests.values()) request.nextAt = Date.now() + noticeDelay(request.api, request.id)
      created.schedule()
    }
    session = created
    notices.set(doc, session)
    doc.addEventListener('visibilitychange', created.visibility)
  }
  const current = session
  const key = keyFor(api, id)
  const existing = current.requests.get(key)
  const request = existing ?? { api, id, subscribers: 0, nextAt: Date.now() + noticeDelay(api, id), pending: false, release: () => {} }
  request.subscribers++
  current.requests.set(key, request)
  if (!existing) request.release = subscribePlacements(api, id, () => {
    if (placementsPending(api, id)) return
    // Manual/focus retries also reset the backoff after recovery.
    request.nextAt = Date.now() + noticeDelay(api, id)
    current.schedule()
  })
  if (!existing || current.timer === undefined) current.schedule()
  let active = true
  return () => {
    if (!active) return
    active = false
    if (--request.subscribers === 0) { current.removeRequest(key); request.release() }
    if (!current.requests.size) {
      if (current.timer !== undefined) clearTimeout(current.timer)
      doc.removeEventListener('visibilitychange', current.visibility)
      notices.delete(doc)
    }
  }
}

import type { DocId } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { isPreflightResult, readPreflight } from '../../testSurface/readPreflight.js'
import { classifyReadinessRead, type ReadinessRead } from '../../testSurface/readinessRead.js'

type Placements = PreflightResult['placements']
type Entry = { controller: AbortController; promise: Promise<Placements | undefined>; pending: boolean; blocking: boolean; startedAt: number; failures: number; value?: Placements; previousPreflight?: PreflightResult; preflight?: PreflightResult; response?: Response; read?: ReadinessRead; previousRead?: ReadinessRead }
const cache = new Map<string, Entry>()
const latest = new Map<string, Entry>()
type Consumer = (placements: Placements | undefined) => void
type Consumers = { listeners: Set<Consumer>; removeListener: (notify: Consumer) => void }
const consumers = new Map<string, Consumers>()
const keyFor = (api: string, id: DocId) => JSON.stringify([api, String(id)])

function read(api: string, id: DocId, fresh: boolean, blocking = false): Entry {
  const key = keyFor(api, id)
  const cached = cache.get(key)
  if (cached && (!fresh || cached.pending)) return cached
  const controller = new AbortController()
  const previous = latest.get(key)
  const entry: Entry = { controller, pending: true, blocking, startedAt: Date.now(), failures: previous?.failures ?? 0, value: previous?.value, previousPreflight: previous?.preflight ?? (previous?.pending ? previous.previousPreflight : undefined), previousRead: previous?.read ?? previous?.previousRead, promise: undefined! }
  cache.set(key, entry)
  latest.set(key, entry)
  for (const notify of consumers.get(key)?.listeners ?? []) notify(entry.value)
  entry.promise = (async () => {
    try {
      const { response, body: data } = await readPreflight(signal => fetch(`${api}/xp/experiments/${encodeURIComponent(id)}/preflight`, {
        credentials: 'include', cache: 'no-store', signal,
      }), controller.signal)
      entry.read = classifyReadinessRead(response.status, data, entry.failures + 1, { kind: 'where-used' })
      if (!response.ok) { entry.response = new Response(JSON.stringify(data), { status: response.status, headers: response.headers }); return }
      if (!isPreflightResult(data)) return
      entry.preflight = data
      if (data.checks?.some(check => !check.ok && check.code === 'no-placements' && check.detail !== undefined)) return
      return Array.isArray(data.placements) ? data.placements : undefined
    } catch { return undefined }
  })().then(placements => {
    entry.pending = false
    entry.read ??= classifyReadinessRead(0, undefined, entry.failures + 1, { kind: 'where-used' })
    entry.failures = entry.read.failed ? entry.failures + 1 : 0
    entry.value = placements
    if (cache.get(key) === entry) {
      if (!entry.preflight) cache.delete(key)
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
  if (consumers.get(key)?.listeners.size) void read(api, id, true, true).promise
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

/** Mandatory post-write/refusal reads guard Start in every shared consumer. */
export function placementsBlocking(api: string, id: DocId) {
  const entry = cache.get(keyFor(api, id))
  return entry?.pending === true && entry.blocking
}

export function placementsPending(api: string, id: DocId) { return cache.get(keyFor(api, id))?.pending === true }

/** Pending reads retain the complete settled classification, including terminal outcomes. */
export function cachedReadinessRead(api: string, id: DocId) {
  const entry = latest.get(keyFor(api, id))
  return entry?.pending ? entry.previousRead : entry?.read
}
export function placementReadError(api: string, id: DocId): string | undefined {
  return cachedReadinessRead(api, id)?.message
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
const noticeDelay = (api: string, id: DocId) => cachedReadinessRead(api, id)?.pollDelay ?? null
export function watchPlacementNotice(api: string, id: DocId, doc: Document): () => void {
  let session = notices.get(doc)
  if (!session) {
    const requests = new Map<string, NoticeRequest>()
    const created: NoticeSession = { requests, removeRequest: key => { requests.delete(key) }, visibility: () => {}, schedule: () => {} }
    created.schedule = () => {
      if (created.timer !== undefined) { clearTimeout(created.timer); created.timer = undefined }
      const eligible = [...created.requests.values()].filter(request => !request.pending && noticeDelay(request.api, request.id) !== null)
      if (doc.visibilityState !== 'visible' || !eligible.length) return
      created.timer = setTimeout(() => {
        created.timer = undefined
        if (doc.visibilityState !== 'visible') return
        const due = eligible.filter(request => created.requests.get(keyFor(request.api, request.id)) === request && request.nextAt <= Date.now())
        for (const request of due) {
          request.pending = true
          void refreshPlacements(request.api, request.id).then(() => {
            request.pending = false
            request.nextAt = Date.now() + (noticeDelay(request.api, request.id) ?? 0)
            if (notices.get(doc) === created) created.schedule()
          })
        }
        created.schedule()
      }, Math.max(0, Math.min(...eligible.map(request => request.nextAt)) - Date.now()))
    }
    created.visibility = () => {
      for (const request of created.requests.values()) request.nextAt = Date.now() + (noticeDelay(request.api, request.id) ?? 0)
      created.schedule()
    }
    session = created
    notices.set(doc, session)
    doc.addEventListener('visibilitychange', created.visibility)
  }
  const current = session
  const key = keyFor(api, id)
  const existing = current.requests.get(key)
  const request = existing ?? { api, id, subscribers: 0, nextAt: Date.now() + (noticeDelay(api, id) ?? 0), pending: false, release: () => {} }
  request.subscribers++
  current.requests.set(key, request)
  if (!existing) request.release = subscribePlacements(api, id, () => {
    if (placementsPending(api, id)) return
    // Manual/focus retries also reset the backoff after recovery.
    request.nextAt = Date.now() + (noticeDelay(api, id) ?? 0)
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

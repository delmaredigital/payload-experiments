import { createManifestCache } from '../manifest/cache.js'
import type { Attributes } from '../types/contracts.js'
import type { Assignments } from '../types/assignments.js'
import type { Manifest } from '../types/manifest.js'
import type { ExperimentsProxyRuntime } from '../types/runtime.js'

interface RuntimeCache {
  cache: ReturnType<typeof createManifestCache>
  forced?: Promise<Manifest | null>
}
const caches = new WeakMap<ExperimentsProxyRuntime, RuntimeCache>()
// Rendering details stay server-side, outside the frozen public assignment wire shape.
const manifests = new WeakMap<Assignments, Manifest>()
const requestAttributeSets = new WeakMap<Assignments, Readonly<Attributes>>()
export const emptyManifest = (): Manifest => ({ v: 1, revision: 0, experiments: [], flagDefaults: {}, archivedWinners: {}, archivedPages: {} })

export async function serverManifest(runtime: ExperimentsProxyRuntime, reload = false): Promise<Manifest | null> {
  if (!runtime.loadManifest) return null
  let entry = caches.get(runtime)
  if (!entry) {
    entry = { cache: createManifestCache(runtime.loadManifest) }
    caches.set(runtime, entry)
  }
  if (entry.forced) return entry.forced
  if (!reload) return entry.cache.get()
  const state = entry, load = runtime.loadManifest
  state.forced = (async () => {
    const previous = await state.cache.get()
    let initial = true
    const refreshed = createManifestCache(async opts => {
      const first = initial
      initial = false
      const value = await load(first && previous ? { ifRevision: previous.revision } : opts)
      // Only the cold forced read needs seeding. Later refreshes use this cache's
      // own revision and last-good retention, rather than the original snapshot.
      return first && (value === 'not-modified' || value === null) ? previous : value
    })
    const value = await refreshed.get()
    if (value) state.cache = refreshed
    return value ?? previous
  })().finally(() => { state.forced = undefined })
  return state.forced
}

export function rememberManifest(assignments: Assignments, manifest: Manifest, attributes?: Attributes): Assignments {
  manifests.set(assignments, manifest)
  if (attributes) requestAttributeSets.set(assignments, Object.freeze({ ...attributes }))
  return assignments
}
export const requestAttributesOf = (assignments: Assignments): Readonly<Attributes> => requestAttributeSets.get(assignments) ?? {}
export const manifestOf = (assignments: Assignments): Manifest | undefined => manifests.get(assignments)
export const suppressExposure = (a: Assignments): boolean => a.staff || a.bot || a.preview || ['HEAD', 'UNKNOWN'].includes(a.method.toUpperCase())

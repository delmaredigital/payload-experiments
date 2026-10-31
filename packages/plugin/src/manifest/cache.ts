import type { Manifest } from '../types/manifest.js'
import type { ManifestLoader } from '../runtime/loaders.js'

export function createManifestCache(load: ManifestLoader, { ttlMs = 30_000, coldStartMs = 1_500, now = Date.now }: { ttlMs?: number; coldStartMs?: number; now?: () => number } = {}): { get(): Promise<Manifest | null> } {
  let cached: Manifest | null = null
  let checkedAt = -Infinity
  let inFlight: Promise<Manifest | null> | undefined
  function refresh() {
    if (!inFlight) {
      inFlight = Promise.resolve().then(() => load(cached ? { ifRevision: cached.revision } : {})).then(result => {
        if (result !== 'not-modified') cached = result
        checkedAt = now()
        return cached
      }, () => {
        checkedAt = now()
        return cached
      }).finally(() => { inFlight = undefined })
    }
    return inFlight
  }
  return {
    async get() {
      if (now() - checkedAt < ttlMs) return cached
      const pending = refresh()
      if (cached) return cached
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([pending, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), coldStartMs) })])
      } finally { if (timer !== undefined) clearTimeout(timer) }
    },
  }
}

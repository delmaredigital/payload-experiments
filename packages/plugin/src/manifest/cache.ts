import type { Manifest } from '../types/manifest.js'
import type { ManifestLoader } from '../runtime/loaders.js'

export function createManifestCache(load: ManifestLoader, { ttlMs = 30_000, coldStartMs = 1_500, refreshTimeoutMs = 5_000, now = Date.now }: { ttlMs?: number; coldStartMs?: number; refreshTimeoutMs?: number; now?: () => number } = {}): { get(): Promise<Manifest | null> } {
  let cached: Manifest | null = null
  let checkedAt = -Infinity
  let inFlight: Promise<Manifest | null> | undefined
  function refresh() {
    if (!inFlight) {
      const expired = new Error('Manifest refresh timed out')
      let timer: ReturnType<typeof setTimeout> | undefined
      const pending = Promise.resolve().then(() => load(cached ? { ifRevision: cached.revision } : {}))
      inFlight = Promise.race([pending, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(expired), refreshTimeoutMs)
      })]).then(result => {
        if (result !== 'not-modified') cached = result
        checkedAt = now()
        return cached
      }, error => {
        // A timed-out attempt must not pin inFlight or delay the next retry.
        // Its late result is ignored: only the race winner can mutate the cache.
        checkedAt = error === expired ? -Infinity : now()
        return cached
      }).finally(() => { clearTimeout(timer); inFlight = undefined })
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

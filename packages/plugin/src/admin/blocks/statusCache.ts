import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { createApi } from '../api.js'
import type { BlockStatus } from './model.js'

type Entry = { value: BlockStatus | null; owners: number; mounts: WeakSet<object>; revision: number; pending?: Promise<void> }
const cache = new Map<string, Entry>()
// Subscribers do not create status entries: a label alone owns no cached data.
const listeners = new Map<string, { callbacks: Set<() => void> }>()
const keyOf = (api: string, slug: string) => JSON.stringify([api, slug])
const publish = (key: string) => listeners.get(key)?.callbacks.forEach(listener => listener())
export const validBlockSlug = (slug: unknown): slug is string => typeof slug === 'string' && slug.length > 0 && slug.length <= 64

/** Update a mounted owner's snapshot and invalidate an older pending read. */
export function setBlockStatus(api: string, slug: string, value: BlockStatus): void {
  const key = keyOf(api, slug), current = cache.get(key)
  if (!current) return
  current.revision++
  current.value = value
  publish(key)
}

/** Only status fields own reads. StrictMode replays the same mount token; a
 * different owner after the last cleanup starts fresh, even in the same commit.
 * Deferred eviction removes every entry with no live owner after that commit.
 */
export function useBlockStatus(api: string, slug: unknown, owner = false): BlockStatus | null {
  const key = validBlockSlug(slug) ? keyOf(api, slug) : undefined
  const token = useRef({})
  const subscribe = useCallback((listener: () => void) => {
    if (!key) return () => {}
    let current = listeners.get(key)
    if (!current) { current = { callbacks: new Set() }; listeners.set(key, current) }
    current.callbacks.add(listener)
    return () => {
      current.callbacks = new Set([...current.callbacks].filter(item => item !== listener))
      if (!current.callbacks.size) listeners.delete(key)
    }
  }, [key])
  const status = useSyncExternalStore(subscribe, () => {
    const current = key ? cache.get(key) : undefined
    // A new owner must not sync with the previous mount's snapshot before its
    // effect registers ownership (or starts the fresh read).
    return current && (!owner || current.mounts.has(token.current)) ? current.value : null
  }, () => null)
  useEffect(() => {
    if (!key || !owner || !validBlockSlug(slug)) return
    let current = cache.get(key)
    if (!current || (!current.owners && !current.mounts.has(token.current))) {
      current = { value: null, owners: 0, mounts: new WeakSet(), revision: 0 }
      cache.set(key, current)
    }
    const owned = current
    owned.owners++
    owned.mounts.add(token.current)
    publish(key)
    const revision = owned.revision
    if (!owned.pending) owned.pending = createApi(api).placementStatus({ slugs: [slug] }).then(result => {
      if (cache.get(key) !== owned || owned.revision !== revision) return
      owned.value = result.ok ? result.data?.slugs[slug] ?? null : null
      publish(key)
    })
    return () => {
      owned.owners--
      queueMicrotask(() => {
        if (!owned.owners && cache.get(key) === owned) { cache.delete(key); publish(key) }
      })
    }
  }, [api, key, slug, owner])
  return status
}

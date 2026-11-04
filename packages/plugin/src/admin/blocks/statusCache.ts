import { useEffect, useSyncExternalStore } from 'react'
import { createApi } from '../api.js'
import type { BlockStatus } from './model.js'

type Entry = { value: BlockStatus | null; owners: number; pending?: Promise<void>; listeners: Set<() => void> }
const cache = new Map<string, Entry>()
const keyOf = (api: string, slug: string) => JSON.stringify([api, slug])
function entry(key: string): Entry {
  let value = cache.get(key)
  if (!value) { value = { value: null, owners: 0, listeners: new Set() }; cache.set(key, value) }
  return value
}
export const validBlockSlug = (slug: unknown): slug is string => typeof slug === 'string' && slug.length > 0 && slug.length <= 64

/** Only the status field owns a request. Labels and actions subscribe to it.
 * Deferred eviction survives StrictMode's effect replay; no entry survives a
 * completed owner unmount. A second mounted placement shares the same request.
 */
export function useBlockStatus(api: string, slug: unknown, owner = false): BlockStatus | null {
  const key = validBlockSlug(slug) ? keyOf(api, slug) : undefined
  const status = useSyncExternalStore(listener => {
    if (!key) return () => {}
    const current = entry(key)
    current.listeners.add(listener)
    return () => { current.listeners = new Set([...current.listeners].filter(item => item !== listener)) }
  }, () => key ? cache.get(key)?.value ?? null : null, () => null)
  useEffect(() => {
    if (!key || !owner || !validBlockSlug(slug)) return
    const current = entry(key)
    current.owners++
    if (!current.pending) current.pending = createApi(api).placementStatus({ slugs: [slug] }).then(result => {
      current.value = result.ok ? result.data?.slugs[slug] ?? null : null
      current.listeners.forEach(listener => listener())
    })
    return () => {
      current.owners--
      queueMicrotask(() => { if (!current.owners && cache.get(key) === current) cache.delete(key) })
    }
  }, [api, key, slug, owner])
  return status
}

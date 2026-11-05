'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PreflightResult } from '../../types/endpoints.js'
import { createApi } from '../api.js'
import { placementDetail, placementDetailKey, preflightPlacementLabel, resolvedPlacementLabel } from './placementLabels.js'
import type { PlacementLabel } from './placementLabels.js'
export { placementDetailKey } from './placementLabels.js'

/** The view owns a cache, including misses, so repeated warnings never repeat reads. */
export function usePlacementLabels({ details, preflight, apiRoute, adminRoute, canManage, collectionTitles }: {
  details: unknown[]; preflight?: PreflightResult | null; apiRoute: string; adminRoute: string; canManage: boolean; collectionTitles?: Record<string, string>
}): Map<string, PlacementLabel> {
  const titlesSignature = JSON.stringify(collectionTitles)
  const cache = useMemo(() => new Map<string, PlacementLabel>(), [apiRoute, adminRoute, titlesSignature])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [, refresh] = useState(0)
  const signature = JSON.stringify(details.map(placementDetail))
  useEffect(() => {
    if (!canManage || preflight) return
    const pending = [...new Map((JSON.parse(signature) as unknown[]).map(detail => [placementDetailKey(detail), detail])).values()].filter(detail => !cache.has(placementDetailKey(detail)))
    const blocks = new Map<string, unknown[]>()
    const jobs: Promise<void>[] = []
    const save = (value: unknown, label: PlacementLabel) => { cache.set(placementDetailKey(value), label) }
    for (const value of pending) {
      const detail = placementDetail(value)
      // Reserve immediately: repeated renders do not issue duplicate requests.
      save(value, resolvedPlacementLabel(value, undefined, adminRoute))
      if (!detail.collection) continue
      if (detail.id != null) { blocks.set(detail.collection, [...blocks.get(detail.collection) ?? [], value]); continue }
      if (!detail.path) continue
      jobs.push(createApi(apiRoute).pages({ collection: detail.collection, path: detail.path }).then(result => {
        if (result.ok) save(value, resolvedPlacementLabel(value, result.data?.docs[0], adminRoute))
      }))
    }
    for (const [collection, values] of blocks) jobs.push((async () => {
      try {
        const ids = [...new Set(values.map(value => String(placementDetail(value).id)))]
        const query = new URLSearchParams({ 'where[id][in]': ids.join(','), depth: '0', limit: String(ids.length) })
        const response = await fetch(`${apiRoute.replace(/\/$/, '')}/${encodeURIComponent(collection)}?${query}`, { credentials: 'include' })
        if (!response.ok) return
        const data = await response.json() as { docs?: Array<Record<string, unknown>> }
        const titleField = collectionTitles?.[collection]
        for (const value of values) {
          const doc = data.docs?.find(doc => String(doc.id) === String(placementDetail(value).id))
          if (doc) save(value, resolvedPlacementLabel(value, { id: placementDetail(value).id, title: titleField && typeof doc[titleField] === 'string' ? doc[titleField] as string : undefined }, adminRoute))
        }
      } catch { /* An unreadable placement retains the neutral fallback. */ }
    })())
    void Promise.all(jobs).then(() => { if (mounted.current && jobs.length) refresh(value => value + 1) })
  }, [signature, preflight, apiRoute, adminRoute, canManage, collectionTitles, cache])
  return new Map(details.map(detail => [placementDetailKey(detail), preflight ? preflightPlacementLabel(detail, preflight, adminRoute) : canManage ? cache.get(placementDetailKey(detail)) ?? resolvedPlacementLabel(detail, undefined, adminRoute) : resolvedPlacementLabel(detail, undefined, adminRoute)]))
}

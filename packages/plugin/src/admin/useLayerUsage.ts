'use client'
import { useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { DocId } from '../types/contracts.js'
import type { LayerExperiment } from './layerUsage.model.js'
import { layerUsage } from './layerUsage.model.js'

// Shared by the layer document and the allocation field; all requests use the editor's access.
export function useLayerExperiments(layerId: DocId | null) {
  const { config } = useConfig()
  const api = config.routes.api
  const id = layerId == null ? null : String(layerId)
  const [state, setState] = useState<{ api: string; id: string; usage: ReturnType<typeof layerUsage> } | null>(null)
  useEffect(() => {
    setState(null)
    if (id == null) return
    const controller = new AbortController()
    async function load() {
      const docs: LayerExperiment[] = []
      let page = 1
      while (!controller.signal.aborted) {
        const query = new URLSearchParams({ depth: '0', limit: '100', page: String(page),
          'where[layer][equals]': id!, 'where[status][in]': 'running,decided' })
        const response = await fetch(`${api}/xp-experiments?${query}`, { credentials: 'include', signal: controller.signal })
        if (!response.ok) { if (!controller.signal.aborted) setState(null); return }
        const data = await response.json() as { docs: LayerExperiment[]; hasNextPage?: boolean }
        docs.push(...data.docs)
        if (!data.hasNextPage) break
        page++
      }
      if (!controller.signal.aborted) setState({ api, id: id!, usage: layerUsage(docs) })
    }
    void load().catch(() => { if (!controller.signal.aborted) setState(null) })
    return () => controller.abort()
  }, [api, id])
  return id != null && state?.api === api && state.id === id ? state.usage : null
}

export function useLayerUsage(layerId: DocId | null): { name: string; used: number; free: number } | null {
  const { config } = useConfig()
  const api = config.routes.api
  const id = layerId == null ? null : String(layerId)
  const usage = useLayerExperiments(layerId)
  const [state, setState] = useState<{ api: string; id: string; name: string } | null>(null)
  useEffect(() => {
    setState(null)
    if (id == null) return
    const controller = new AbortController()
    void fetch(`${api}/xp-layers/${encodeURIComponent(id)}?depth=0`, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) { if (!controller.signal.aborted) setState(null); return }
        const doc = await response.json() as { name: string }
        if (!controller.signal.aborted) setState({ api, id, name: doc.name })
      }).catch(() => { if (!controller.signal.aborted) setState(null) })
    return () => controller.abort()
  }, [api, id])
  return usage && id != null && state?.api === api && state.id === id
    ? { name: state.name, used: usage.used, free: usage.free } : null
}

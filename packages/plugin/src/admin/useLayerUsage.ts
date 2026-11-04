'use client'
import { fetchAllDocs } from '../lib/fetchAllDocs.js'
import { useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { DocId } from '../types/contracts.js'
import type { LayerExperiment } from './layerUsage.model.js'
import { layerUsage } from './layerUsage.model.js'

// Used by the layer document; all requests use the editor's access.
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
      const query = new URLSearchParams({ depth: '0',
        'where[layer][equals]': id!, 'where[status][in]': 'running,decided' })
      const response = await fetchAllDocs<LayerExperiment>(`${api}/xp-experiments?${query}`, { credentials: 'include', signal: controller.signal })
      if (!response.ok) { if (!controller.signal.aborted) setState(null); return }
      if (!controller.signal.aborted) setState({ api, id: id!, usage: layerUsage(response.docs) })
    }
    void load().catch(() => { if (!controller.signal.aborted) setState(null) })
    return () => controller.abort()
  }, [api, id])
  return id != null && state?.api === api && state.id === id ? state.usage : null
}


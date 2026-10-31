'use client'
import { useDocumentInfo } from '@payloadcms/ui'
import type { UIFieldClientProps } from 'payload'
import { useLayerExperiments } from './useLayerUsage.js'
import { statusLabel } from './labels.js'
import { HISTORY_COPY, layerRow, layerSummary } from './copy/history.js'

export function LayerUsage(_props: UIFieldClientProps) {
  const { id } = useDocumentInfo()
  const usage = useLayerExperiments(id ?? null)
  if (id == null || !usage) return null
  return <section aria-label={HISTORY_COPY.layers}>
    <p>{layerSummary(usage.used, usage.free)}</p>
    <ul>{usage.rows.map((row, index) => <li key={index}>{layerRow(row.name, statusLabel(row.status), row.slices)}</li>)}</ul>
  </section>
}

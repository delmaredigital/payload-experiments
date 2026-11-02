'use client'
import { FieldDescription, FieldLabel, useDocumentInfo } from '@payloadcms/ui'
import type { UIFieldClientProps } from 'payload'
import { useLayerExperiments } from './useLayerUsage.js'
import { statusLabel } from './labels.js'
import { HISTORY_COPY, layerRow, layerSummary } from './copy/history.js'

export function LayerUsage({ field, path }: UIFieldClientProps) {
  const { id } = useDocumentInfo()
  const usage = useLayerExperiments(id ?? null)
  if (id == null || !usage) return null
  const description = field.admin?.description
  const staticDescription = typeof description === 'object'
    ? Object.fromEntries(Object.entries(description).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : description
  return <section aria-label={HISTORY_COPY.layers}>
    <FieldLabel as="h3" label={field.label} path={path} />
    <FieldDescription description={staticDescription} path={path} />
    <p>{layerSummary(usage.used, usage.free)}</p>
    <ul>{usage.rows.map((row, index) => <li key={index}>{layerRow(row.name, statusLabel(row.status), row.slices)}</li>)}</ul>
  </section>
}

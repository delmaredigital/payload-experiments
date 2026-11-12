'use client'
import { FieldDescription, FieldLabel, useDocumentInfo } from '@payloadcms/ui'
import type { ComponentProps } from 'react'
import type { UIFieldClientProps } from 'payload'
import { useLayerExperiments } from './useLayerUsage.js'
import { statusLabel } from '../testSurface/labels.js'
import { HISTORY_COPY, layerRow, layerSummary } from './copy/history.js'

export function LayerUsage({ field, path }: UIFieldClientProps) {
  const { id } = useDocumentInfo()
  const usage = useLayerExperiments(id ?? null)
  return <section aria-label={HISTORY_COPY.layers}>
    <FieldLabel as="h3" label={field.label} path={path} />
    <FieldDescription description={field.admin?.description as ComponentProps<typeof FieldDescription>['description']} path={path} />
    {usage ? <><p>{layerSummary(usage.used, usage.free)}</p>
    <ul>{usage.rows.map((row, index) => <li key={index}>{layerRow(row.name, statusLabel(row.status), row.slices)}</li>)}</ul></> : null}
  </section>
}

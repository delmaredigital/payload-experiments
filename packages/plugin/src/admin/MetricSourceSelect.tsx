'use client'
import { SelectInput, useField } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import type { SerializedMetricSource } from '../types/admin.js'
import { metricSourceHint, metricSourceOptions, sourceFor } from '../testSurface/metricSource.model.js'
import { METRICS_COPY } from '../testSurface/copy/metrics.js'

export function MetricSourceSelect({ path, field, readOnly }: TextFieldClientProps) {
  const { value, setValue } = useField<string>({ path })
  const sources = (field.admin?.custom?.sources ?? []) as SerializedMetricSource[]
  const hint = metricSourceHint(sourceFor(value, sources))
  const locked = Boolean(readOnly || field.admin?.readOnly)
  return <div>
    <SelectInput path={path} name={path} label={field.label ?? METRICS_COPY.source} description={field.admin?.description} required={field.required}
      options={metricSourceOptions(sources)} value={sourceFor(value, sources)?.id ?? value ?? ''} readOnly={locked}
      onChange={option => { if (!locked) setValue(option && !Array.isArray(option) ? option.value : null) }} />
    {hint ? <p>{hint}</p> : null}
  </div>
}

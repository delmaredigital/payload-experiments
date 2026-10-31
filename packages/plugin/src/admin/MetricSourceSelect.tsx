'use client'
import { SelectInput, useField } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import type { SerializedMetricSource } from '../types/admin.js'
import { metricSourceHint, metricSourceOptions } from './metricSource.model.js'
import { METRICS_COPY } from './copy/metrics.js'

export function MetricSourceSelect({ path, field, readOnly }: TextFieldClientProps) {
  const { value, setValue } = useField<string>({ path })
  const sources = (field.admin?.custom?.sources ?? []) as SerializedMetricSource[]
  const hint = metricSourceHint(sources.find(source => source.id === value))
  const locked = Boolean(readOnly || field.admin?.readOnly)
  return <div>
    <SelectInput path={path} name={path} label={METRICS_COPY.source} required={field.required}
      options={metricSourceOptions(sources)} value={value ?? ''} readOnly={locked}
      onChange={option => { if (!locked) setValue(option && !Array.isArray(option) ? option.value : null) }} />
    {hint ? <p>{hint}</p> : null}
  </div>
}

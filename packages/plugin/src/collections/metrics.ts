import type { CollectionConfig } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import { XP_METRIC_SOURCE_SELECT } from '../admin/paths.js'
import { managedAccess } from './access.js'
import { serializeMetricSources } from './serialize.js'

export function metricsCollection(options: ResolvedOptions): CollectionConfig {
  const sources = serializeMetricSources(options)
  return {
    slug: 'xp-metrics', graphQL: false, disableDuplicate: true, admin: { useAsTitle: 'name' }, access: managedAccess(options),
    hooks: { beforeValidate: [({ data, originalDoc }) => {
      if (!data) return data
      const source = sources.find(source => source.id === (data.source ?? originalDoc?.source))
      const capping = data.capping === undefined ? originalDoc?.capping : data.capping
      // Payload may submit an empty optional group as { type: null, value: null }.
      const hasCapping = capping != null && (capping.type != null || capping.value != null)
      if (source?.kind === 'revenue' && !hasCapping) data.capping = { type: 'percentile', value: 0.99 }
      return data
    }] },
    fields: [
      { name: 'name', type: 'text', required: true }, { name: 'slug', type: 'text', required: true, unique: true },
      { name: 'source', type: 'text', required: true, validate: (value: unknown) => sources.some(source => source.id === value) || 'Choose a registered metric source.', admin: { components: { Field: XP_METRIC_SOURCE_SELECT }, custom: { sources } } },
      { name: 'direction', type: 'select', required: true, defaultValue: 'increase', options: ['increase', 'decrease'] },
      { name: 'attributionWindowHours', type: 'number', defaultValue: 168, min: 0 },
      { name: 'capping', type: 'group', fields: [
        { name: 'type', type: 'select', options: ['percentile', 'absolute'],
          validate: (value: unknown, { data, siblingData }: { data?: { source?: string }; siblingData?: { value?: unknown } }) => {
            const hasCapping = value != null || siblingData?.value != null
            const source = sources.find(source => source.id === data?.source)
            if (hasCapping && source && source.kind !== 'revenue') return 'Count and conversion metrics cannot be capped.'
            return !hasCapping || value === 'percentile' || value === 'absolute' || 'Choose a capping type.'
          } },
        { name: 'value', type: 'number', min: 0, validate: (value: number | null | undefined, { siblingData }: { siblingData?: { type?: unknown } }) => {
          if (value == null && !siblingData?.type) return true
          return (typeof value === 'number' && Number.isFinite(value) && value >= 0 && (siblingData?.type === 'absolute' || (siblingData?.type === 'percentile' && value > 0 && value <= 1))) || 'Enter a valid cap (percentiles must be greater than 0 and at most 1).'
        } },
      ] },
      { name: 'minSampleSize', type: 'number', defaultValue: 150, min: 1 },
      { name: 'guardrailThreshold', type: 'number', defaultValue: 0.05, min: 0 },
    ],
  }
}

import type { CollectionConfig } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import { XP_METRIC_SOURCE_SELECT } from '../admin/paths.js'
import { managedAccess } from './access.js'
import { serializeMetricSources } from './serialize.js'
import { validateCappingType, validateCappingValue } from './metricValidation.js'

export function metricsCollection(options: ResolvedOptions): CollectionConfig {
  const sources = serializeMetricSources(options)
  return {
    slug: 'xp-metrics', graphQL: false, disableDuplicate: true,
    // group:false hides navigation while keeping collection routes reachable (hidden causes 404s).
    labels: { singular: 'Goal', plural: 'Goals' }, admin: { group: false, useAsTitle: 'name' }, access: managedAccess(options),
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
      { name: 'name', label: 'Name', type: 'text', required: true, admin: { description: 'Give this goal a name people will recognize.' } },
      { name: 'slug', label: 'Short name (used in code)', type: 'text', required: true, unique: true, admin: { description: 'Use a unique short name for code that refers to this goal.' } },
      { name: 'source', label: 'Measured by', type: 'text', required: true, validate: (value: unknown) => sources.some(source => source.id === value) || 'Choose what this goal is measured by.', admin: { description: 'Choose the outcome this goal measures.', components: { Field: XP_METRIC_SOURCE_SELECT }, custom: { sources } } },
      { name: 'direction', label: 'Better when it goes', type: 'select', required: true, defaultValue: 'increase', options: [{ label: 'Goes up', value: 'increase' }, { label: 'Goes down', value: 'decrease' }], admin: { description: 'Choose whether a higher or lower result is better.' } },
      { name: 'attributionWindowHours', label: 'Count results for (hours)', type: 'number', defaultValue: 168, min: 1, admin: { description: 'Count outcomes during this many hours after someone sees a version.' } },
      { name: 'capping', label: 'Limit very large values', type: 'group', admin: { description: 'Limit unusually large amounts when comparing results while keeping totals in full.' }, fields: [
        { name: 'type', label: 'Limit by', type: 'select', options: [{ label: 'Based on past amounts', value: 'percentile' }, { label: 'Fixed amount', value: 'absolute' }], admin: { description: 'Choose whether the limit comes from past amounts or a fixed amount.' },
          validate: (value: unknown, { data, siblingData }: { data?: { source?: string }; siblingData?: { value?: unknown } }) => {
            const source = sources.find(source => source.id === data?.source)
            return validateCappingType(value, siblingData?.value, source?.kind)
          } },
        { name: 'value', label: 'Limit value', type: 'number', min: 0, admin: { description: 'For past amounts, enter how much of the usual range to keep, such as 0.99 to limit only the largest 1%; or enter a fixed amount.' }, validate: (value: number | null | undefined, { siblingData }: { siblingData?: { type?: unknown } }) => {
          return validateCappingValue(value, siblingData?.type)
        } },
      ] },
      { name: 'minSampleSize', label: 'Minimum completions before deciding', type: 'number', defaultValue: 150, min: 1, admin: { description: 'Wait until each version has at least this many people who completed the goal before showing a result.' } },
      { name: 'guardrailThreshold', label: 'Warn when it gets worse by', type: 'number', defaultValue: 0.05, min: 0, admin: { description: 'When this goal is a safety check, warn if it gets worse by this fraction, such as 0.05 for 5%.' } },
    ],
  }
}

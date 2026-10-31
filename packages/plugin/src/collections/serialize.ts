import type { ResolvedOptions } from '../types/contracts.js'
import type { SerializedAttributeKeys, SerializedFlagPoint, SerializedMetricSource } from '../types/admin.js'

export function serializeFlagPoints(options: ResolvedOptions): SerializedFlagPoint[] {
  return (options.flagPoints ?? []).map(({ id, label, params, defaultParams }) => ({
    id, label, params, defaultParams, effectiveDefaults: defaultParams,
  }))
}

export function serializeMetricSources(options: ResolvedOptions): SerializedMetricSource[] {
  return [
    ...(options.metricSources ?? []).map(({ id, label, kind, keyedBy, clientWritable }) => ({
      id, label, kind, keyedBy, clientWritable: clientWritable === true,
    })),
    ...(options.eventSources ?? []).map(name => ({
      id: `events:${name}`, label: name, kind: 'binomial' as const, keyedBy: 'visitor' as const, clientWritable: true,
    })),
  ]
}

export function serializeAttributeKeys(options: ResolvedOptions): SerializedAttributeKeys {
  return Object.fromEntries(Object.entries(options.attributeKeys ?? {}).map(([key, { type, values }]) => [
    key, { type, ...(values ? { values: [...values] } : {}) },
  ]))
}

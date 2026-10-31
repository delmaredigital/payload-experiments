import type { MetricSource, ParamField } from './contracts.js'
export type SerializedFlagPoint = { id: string; label: string; params: Record<string, ParamField>; defaultParams: Record<string, unknown>; effectiveDefaults: Record<string, unknown> }
export type SerializedMetricSource = { id: string; label: string; kind: MetricSource['kind']; keyedBy: MetricSource['keyedBy']; clientWritable: boolean }
export type SerializedAttributeKeys = Record<string, { type: 'string' | 'number' | 'boolean'; values?: string[] }>
export type EditableField = 'name' | 'hypothesis' | 'arms' | 'weights' | 'targeting' | 'allocation' | 'flagPoint' | 'metrics' | 'analysis' | 'exposurePolicy'

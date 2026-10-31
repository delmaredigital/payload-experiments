import type { SerializedMetricSource } from '../types/admin.js'
import { METRICS_COPY, METRIC_KIND_LABELS } from './copy/metrics.js'

export function metricSourceOptions(sources: readonly SerializedMetricSource[]) {
  return sources.map(source => ({ value: source.id, label: `${source.label} · ${METRIC_KIND_LABELS[source.kind]}`, badge: METRIC_KIND_LABELS[source.kind] }))
}
export function metricSourceHint(source?: SerializedMetricSource): string | null {
  return source?.kind === 'revenue' ? METRICS_COPY.revenueHint : null
}

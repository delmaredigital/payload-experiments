import { resolvePercentileCap } from '@delmaredigital/experiments-stats'
import { perUnitHistory } from '../results/history.js'
import type { DocId, MetricSource } from '../types/contracts.js'

export interface MetricDefinition extends Record<string, unknown> {
  id: DocId
  source: string
  attributionWindowHours?: number | null
  minSampleSize?: number | null
  guardrailThreshold?: number | null
  capping?: { type?: 'percentile' | 'absolute' | null; value?: number | null } | null
}

/** Resolve revenue caps before taking transition locks. Host history failures
 * disable capping for that metric and travel back as an explanatory detail.
 */
export async function resolveCaps(metrics: MetricDefinition[], sources: MetricSource[], start: Date) {
  const detail: Array<{ metricId: DocId; message: string }> = []
  const definitions: Array<MetricDefinition & { kind?: MetricSource['kind']; keyedBy?: MetricSource['keyedBy']; resolvedCap: number | null; historyUnits?: number; capNotice?: 'no-history' }> = []
  const from = new Date(start.getTime() - 90 * 86400000)
  for (const metric of metrics) {
    const source = sources.find(source => source.id === metric.source)
    const kind = metric.source.startsWith('events:') ? 'binomial' : source?.kind
    const definition = { ...structuredClone(metric), ...(source ? { keyedBy: source.keyedBy } : {}), kind, resolvedCap: null as number | null, historyUnits: undefined as number | undefined, capNotice: undefined as 'no-history' | undefined }
    const cap = metric.capping?.type ? metric.capping : kind === 'revenue' ? { type: 'percentile' as const, value: 0.99 } : null
    if (kind === 'revenue' || !source && cap && !metric.source.startsWith('events:')) {
      definition.capping = cap
      if (cap?.type === 'absolute' && typeof cap.value === 'number' && Number.isFinite(cap.value) && cap.value >= 0) {
        definition.resolvedCap = cap.value
      } else if (cap?.type === 'percentile') {
        definition.historyUnits = 0
        try {
          if (!source) throw new Error('Metric source unavailable')
          const rows = (await source.query({ from, to: start })).filter(row => new Date(row.ts) >= from && new Date(row.ts) < start)
          if (rows.some(row => !Number.isFinite(row.value))) throw new Error('Invalid metric history')
          const history = perUnitHistory(rows, { windowHours: metric.attributionWindowHours ?? 168 })
          definition.historyUnits = history.units
          if (history.units >= 20) {
            // The collection permits 1 (the maximum); the stats percentile API requires p < 1.
            definition.resolvedCap = cap.value === 1 ? Math.max(...history.values) : resolvePercentileCap(history.values, cap.value ?? 0.99)
          } else {
            definition.capNotice = 'no-history'
            detail.push({ metricId: metric.id, message: 'Fewer than 20 history units; no cap was applied.' })
          }
        } catch {
          definition.capNotice = 'no-history'
          detail.push({ metricId: metric.id, message: 'Metric history is unavailable; no cap was applied.' })
        }
      }
    }
    definitions.push(definition)
  }
  return { definitions, detail }
}

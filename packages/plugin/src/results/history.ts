import type { MetricEvent } from './aggregate.js'

/**
 * Spec §5.4: "Default for revenue sources is `percentile 0.99`; the threshold is resolved at Start from the source's own `query({ from: start − 90 d, to: start })` (no extra host contract): events are aggregated **per unit** with the metric's attribution window anchored at each unit's first event in the lookback (greedy windows), the percentile is taken over those per-unit values (GrowthBook caps unit-level values, not events), and the result is frozen into the phase (`metricDefinitions[].resolvedCap`, with `historyUnits`); fewer than 20 history units → no cap and a notice in the admin."
 * The caller supplies only lookback events. Each unit contributes exactly one value;
 * events at or after its first window's end do not open another window.
 */
export function perUnitHistory(
  events: readonly MetricEvent[],
  { windowHours }: { windowHours: number },
): number[] {
  const first = new Map<string, number>()
  for (const event of events) {
    const ts = event.ts.getTime()
    first.set(event.unitId, Math.min(first.get(event.unitId) ?? Infinity, ts))
  }
  const values = new Map<string, number>()
  for (const unitId of first.keys()) values.set(unitId, 0)
  const duration = windowHours * 60 * 60 * 1000
  for (const event of events) {
    if (event.ts.getTime() < first.get(event.unitId)! + duration) {
      values.set(event.unitId, values.get(event.unitId)! + event.value)
    }
  }
  return [...values.values()]
}

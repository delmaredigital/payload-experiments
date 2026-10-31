import type { MetricEvent } from './aggregate.js'
import { timestampMs, windowMs } from './aggregate.js'

/**
 * Spec §5.4: "Default for revenue sources is `percentile 0.99`; the threshold is resolved at Start from the source's own `query({ from: start − 90 d, to: start })` (no extra host contract): events are aggregated **per unit** in **repeated greedy windows**: the unit's first event in the lookback anchors a window of the metric's attribution length, every event inside `[anchor, anchor + window)` sums into that window's value, the first event at or after the window's end anchors the next window, and so on; each window sum is one value in the percentile population (each matches what one exposure-anchored analysis window would see, and repeat donors contribute several comparable samples), the percentile is taken over those per-unit values (GrowthBook caps unit-level values, not events), and the result is frozen into the phase (`metricDefinitions[].resolvedCap`, with `historyUnits`); fewer than 20 history units → no cap and a notice in the admin."
 * The caller supplies only lookback events. `units` counts distinct units, not windows.
 * Units without events never contribute: this conservative population is close to
 * GrowthBook's ignore-zeros behavior and avoids a cap of 0 at low conversion.
 */
export function perUnitHistory(
  events: readonly MetricEvent[],
  { windowHours }: { windowHours: number },
): { values: number[]; units: number } {
  const duration = windowMs(windowHours)
  const byUnit = new Map<string, { ts: number; value: number }[]>()
  for (const event of events) {
    const row = { ts: timestampMs(event.ts), value: event.value }
    const rows = byUnit.get(event.unitId)
    if (rows) rows.push(row)
    else byUnit.set(event.unitId, [row])
  }
  const values: number[] = []
  for (const rows of byUnit.values()) {
    rows.sort((a, b) => a.ts - b.ts)
    let anchor: number | undefined
    let sum = 0
    for (const row of rows) {
      if (anchor === undefined || row.ts >= anchor + duration) {
        if (anchor !== undefined) values.push(sum)
        anchor = row.ts
        sum = row.value
      } else sum += row.value
    }
    values.push(sum)
  }
  return { values, units: byUnit.size }
}

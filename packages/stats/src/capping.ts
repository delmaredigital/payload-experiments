import type { CapResult } from './types.js'

/**
 * Source: spec §5.4 (composed helper): GrowthBook percentile capping (unit-level),
 * Postgres PERCENTILE_CONT semantics; numpy.quantile(method='linear') is the reference.
 * Throws RangeError unless 0 < p < 1 and every value is finite; empty → null.
 * Sorts a copy, then interpolates v[lo] + (h - lo) * (v[hi] - v[lo]),
 * where h = (n - 1) * p, lo = floor(h), and hi = min(lo + 1, n - 1).
 * Greedy-window per-unit history aggregation and the < 20-unit rule are exp-core's (spec §5.4).
 */
export function resolvePercentileCap(values: readonly number[], p: number): number | null {
  if (!(p > 0 && p < 1) || !values.every(Number.isFinite)) {
    throw new RangeError('Percentile requires 0 < p < 1 and finite values')
  }
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const h = (sorted.length - 1) * p
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!)
}

/**
 * Source: spec §5.4 (composed helper), GrowthBook percentile capping (unit-level).
 * min(v, threshold) on per-unit values BEFORE moments (capValues → summarizeUnits → buildStatistic).
 * Exp-core applies the same cap to CUPED covariates per spec §5.4.
 * Threshold null ⇒ identity (values copied, cappedCount 0, cappedTotal = uncappedTotal).
 * Only v > threshold counts as capped; totals are left-to-right float sums.
 */
export function capValues(values: readonly number[], threshold: number | null): CapResult {
  const cappedValues: number[] = []
  let cappedCount = 0
  let uncappedTotal = 0
  let cappedTotal = 0
  for (const value of values) {
    const capped = threshold === null ? value : Math.min(value, threshold)
    cappedValues.push(capped)
    if (threshold !== null && value > threshold) cappedCount += 1
    uncappedTotal += value
    cappedTotal += capped
  }
  return { values: cappedValues, threshold, cappedCount, uncappedTotal, cappedTotal }
}

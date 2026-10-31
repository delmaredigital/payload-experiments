import type { CapResult } from './types.js'

/**
 * Source: spec §5.4 composed:§5.4 @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * PERCENTILE_CONT(p) (linear interpolation) over whatever per-unit values the caller passes; null on empty; throws unless 0 < p < 1.
 * Greedy-window per-unit history aggregation and the < 20-unit rule are exp-core's (spec §5.4).
 */
export function resolvePercentileCap(values: readonly number[], p: number): number | null {
  throw new Error('not implemented: resolvePercentileCap')
}

/**
 * Source: spec §5.4 composed:§5.4 @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * min(v, threshold) on per-unit values BEFORE moments (capValues → summarizeUnits → buildStatistic);
 * threshold null ⇒ identity (values copied, cappedCount 0, cappedTotal = uncappedTotal); a value equal to the threshold is not counted as capped
 */
export function capValues(values: readonly number[], threshold: number | null): CapResult {
  throw new Error('not implemented: capValues')
}

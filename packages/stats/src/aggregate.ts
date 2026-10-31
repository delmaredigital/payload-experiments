import type { ProportionStatistic, BaseStatistic, RegressionAdjustedStatistic, UnitMoments, UnitMomentsWithCovariate } from './types.js'

/**
 * Source: spec §6.3 (composed helper)
 * left-to-right float sums
 */
export function summarizeUnits(values: readonly number[]): UnitMoments {
  throw new Error('not implemented: summarizeUnits')
}

/**
 * Source: spec §6.3 (composed helper)
 */
export function summarizeUnitsWithCovariate(values: readonly number[], covariates: readonly number[]): UnitMomentsWithCovariate {
  throw new Error('not implemented: summarizeUnitsWithCovariate')
}

/**
 * Source: spec §6.3 (composed helper)
 * binomial → proportion; count/revenue → sampleMean (binomial contract below)
 * binomial → ProportionStatistic(n, sum = converters)
 */
export function buildStatistic(kind: 'binomial' | 'count' | 'revenue', m: UnitMoments): BaseStatistic {
  throw new Error('not implemented: buildStatistic')
}

/**
 * Source: spec §6.3 (composed helper)
 * theta null; pre same type as post; binomial requires 0/1 values AND 0/1 covariates
 */
export function buildRegressionAdjustedStatistic(kind: 'binomial' | 'count' | 'revenue', m: UnitMomentsWithCovariate): RegressionAdjustedStatistic {
  throw new Error('not implemented: buildRegressionAdjustedStatistic')
}

/**
 * Source: spec §6.3 (composed helper)
 * alpha / k; throws k < 1
 */
export function bonferroniAlpha(alpha: number, k: number): number {
  throw new Error('not implemented: bonferroniAlpha')
}

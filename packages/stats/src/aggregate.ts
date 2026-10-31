import type { BaseStatistic, RegressionAdjustedStatistic, UnitMoments, UnitMomentsWithCovariate } from './types.js'

/**
 * Source: spec §6.3 (composed helper)
 * Per-unit inputs accumulate left-to-right: sum += v, sumSquares += v*v.
 * No Kahan or pairwise summation; empty → { n: 0, sum: 0, sumSquares: 0 }.
 */
export function summarizeUnits(values: readonly number[]): UnitMoments {
  let sum = 0
  let sumSquares = 0
  for (const value of values) {
    sum += value
    sumSquares += value * value
  }
  return { n: values.length, sum, sumSquares }
}

/**
 * Source: spec §6.3 (composed helper)
 * Throws RangeError on length mismatch. All sums accumulate left-to-right,
 * including preSum += c, preSumSquares += c*c, postPreSumOfProducts += v*c.
 */
export function summarizeUnitsWithCovariate(values: readonly number[], covariates: readonly number[]): UnitMomentsWithCovariate {
  if (values.length !== covariates.length) {
    throw new RangeError('Values and covariates must have the same length')
  }
  let sum = 0
  let sumSquares = 0
  let preSum = 0
  let preSumSquares = 0
  let postPreSumOfProducts = 0
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!
    const covariate = covariates[i]!
    sum += value
    sumSquares += value * value
    preSum += covariate
    preSumSquares += covariate * covariate
    postPreSumOfProducts += value * covariate
  }
  return { n: values.length, sum, sumSquares, preSum, preSumSquares, postPreSumOfProducts }
}

/**
 * Source: spec §6.3 (composed helper), gbstats.models.statistics.ProportionStatistic /
 * SampleMeanStatistic at 0553a68def700abbcaaca8f5096da913f197804c.
 * binomial → ProportionStatistic(n, sum = converters)
 * Requires sumSquares === sum and sum <= n, otherwise throws RangeError.
 * This is exact under the 0/1 contract: exp-core produces min(1, count) per unit.
 * count/revenue → { type: 'sampleMean', n, sum, sumSquares }.
 */
export function buildStatistic(kind: 'binomial' | 'count' | 'revenue', m: UnitMoments): BaseStatistic {
  const { n, sum, sumSquares } = m
  if (kind === 'binomial') {
    if (!(sumSquares === sum && sum <= n)) {
      throw new RangeError('Binomial moments must represent per-unit 0/1 values')
    }
    return { type: 'proportion', n, sum }
  }
  return { type: 'sampleMean', n, sum, sumSquares }
}

/**
 * Source: spec §6.3 (composed helper), gbstats.models.statistics.RegressionAdjustedStatistic
 * at 0553a68def700abbcaaca8f5096da913f197804c.
 * theta: null; pre and post use buildStatistic with the same kind and n.
 * Binomial requires sumSquares === sum and sum <= n on both sets of moments,
 * otherwise throws RangeError (per-unit 0/1 outcomes AND 0/1 covariates).
 */
export function buildRegressionAdjustedStatistic(kind: 'binomial' | 'count' | 'revenue', m: UnitMomentsWithCovariate): RegressionAdjustedStatistic {
  return {
    type: 'regressionAdjusted',
    n: m.n,
    post: buildStatistic(kind, m),
    pre: buildStatistic(kind, { n: m.n, sum: m.preSum, sumSquares: m.preSumSquares }),
    postPreSumOfProducts: m.postPreSumOfProducts,
    theta: null,
  }
}

/**
 * Source: spec §6.3 (composed helper)
 * Returns alpha / k; throws RangeError unless Number.isInteger(k) && k >= 1
 * and 0 < alpha < 1.
 */
export function bonferroniAlpha(alpha: number, k: number): number {
  if (!Number.isInteger(k) || k < 1 || !(alpha > 0 && alpha < 1)) {
    throw new RangeError('Bonferroni requires integer k >= 1 and 0 < alpha < 1')
  }
  return alpha / k
}

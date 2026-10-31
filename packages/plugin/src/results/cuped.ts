import {
  buildRegressionAdjustedStatistic, buildStatistic, summarizeUnits, summarizeUnitsWithCovariate,
} from '@delmaredigital/experiments-stats'
import type { TestStatistic } from '@delmaredigital/experiments-stats'
import type { MetricSource } from '../types/contracts.js'

/** Build candidate CUPED statistics; the stats engine pools each pair, infers theta,
 * and falls back to the post statistic when pre-period variance/covariance is zero.
 * Missing units in a supplied pre-period map are zero-filled by the caller.
 */
export function outcomeStatistic(
  kind: MetricSource['kind'], values: readonly number[], covariates?: readonly number[],
): { statistic: TestStatistic; moments: ReturnType<typeof summarizeUnits>; covariate?: {
  preSum: number; preSumSquares: number; postPreSumOfProducts: number
} } {
  if (!values.every(Number.isFinite) || (covariates && !covariates.every(Number.isFinite))) {
    throw new RangeError('Metric values and covariates must be finite')
  }
  if (kind === 'binomial' && (values.some(value => value !== 0 && value !== 1)
    || covariates?.some(value => value !== 0 && value !== 1))) {
    throw new RangeError('Binomial values and covariates must be 0 or 1')
  }
  const moments = summarizeUnits(values)
  if (covariates === undefined) return { moments, statistic: buildStatistic(kind, moments) }
  const { preSum, preSumSquares, postPreSumOfProducts } = summarizeUnitsWithCovariate(values, covariates)
  const covariate = { preSum, preSumSquares, postPreSumOfProducts }
  return { moments, covariate, statistic: buildRegressionAdjustedStatistic(kind, { ...moments, ...covariate }) }
}

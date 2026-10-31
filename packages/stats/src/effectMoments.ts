import type { TestStatistic, DifferenceType, EffectMomentsResult, RegressionAdjustedStatistic } from './types.js'
import { createThetaAdjustedStatistics, statisticMean, statisticUnadjustedMean, statisticVariance, computeCovariance } from './statistics.js'
import { ZERO_NEGATIVE_VARIANCE, ZERO_NEGATIVE_BASELINE_VARIATION } from './internal/messages.js'
import { frequentistDiff, frequentistVariance } from './internal/utils.js'

/**
 * Source: gbstats/models/tests.py BaseABTest.compute_moments_result, EffectMoments @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * BaseABTest theta adjustment + one pair, post_stratify=False only; no scaled
 * difference type. post_stratification_applied is projected away.
 */
export function abTestMoments(a: TestStatistic, b: TestStatistic, differenceType: DifferenceType = 'relative'): EffectMomentsResult {
  // Also enforces Python's RA constructor type check through assertRaTypes.
  const [statA, statB] = createThetaAdjustedStatistics(a, b)
  const relative = differenceType === 'relative'
  const defaultOutput = (errorMessage: string): EffectMomentsResult => ({
    pointEstimate: 0, standardError: 0, pairwiseSampleSize: 0, errorMessage,
  })
  const varA = statisticVariance(statA)
  const varB = statisticVariance(statB)
  const variance = (): number => statA.type === 'regressionAdjusted' && statB.type === 'regressionAdjusted' && relative
    ? relativeCupedVariance(statA, statB)
    : frequentistVariance(varA, statisticUnadjustedMean(statA), statA.n, varB, statisticUnadjustedMean(statB), statB.n, relative)

  // Preserve short-circuit/check order: variance, adjusted baseline, unadjusted
  // baseline, then mixed RA/non-RA. Both baseline checks also apply to absolute.
  if (varA <= 0 || varB <= 0 || variance() <= 0) return defaultOutput(ZERO_NEGATIVE_VARIANCE)
  if (statisticMean(statA) === 0) return defaultOutput(ZERO_NEGATIVE_BASELINE_VARIATION)
  if (statisticUnadjustedMean(statA) === 0) return defaultOutput(ZERO_NEGATIVE_BASELINE_VARIATION)
  if (statA.type === 'regressionAdjusted' && statB.type !== 'regressionAdjusted') {
    return defaultOutput('If stat_a is a RegressionAdjustedStatistic, stat_b must be as well')
  }
  if (statB.type === 'regressionAdjusted' && statA.type !== 'regressionAdjusted') {
    return defaultOutput('If stat_b is a RegressionAdjustedStatistic, stat_a must be as well')
  }
  return {
    pointEstimate: frequentistDiff(statisticMean(statA), statisticMean(statB), relative, statisticUnadjustedMean(statA)),
    standardError: Math.sqrt(variance()), pairwiseSampleSize: statA.n + statB.n, errorMessage: null,
  }
}

// Source: gbstats/models/tests.py frequentist_variance_relative_cuped @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
function relativeCupedVariance(a: RegressionAdjustedStatistic, b: RegressionAdjustedStatistic): number {
  const meanA = statisticUnadjustedMean(a)
  const denTrt = b.n * meanA ** 2
  const denCtrl = a.n * meanA ** 2
  if (denTrt === 0 || denCtrl === 0) return 0
  // Python's `theta if theta else 0`, including None and explicit zero.
  const theta = a.theta ?? 0
  const covA = computeCovariance(a.n, a.post, a.pre, a.postPreSumOfProducts)
  const covB = computeCovariance(b.n, b.post, b.pre, b.postPreSumOfProducts)
  const numTrt = statisticVariance(b.post) + theta ** 2 * statisticVariance(b.pre) - 2 * theta * covB
  const vTrt = numTrt / denTrt
  const constant = -statisticMean(b.post)
  const numA = statisticVariance(a.post) * constant ** 2 / statisticMean(a.post) ** 2
  const numB = 2 * theta * covA * constant / statisticMean(a.post)
  const numC = theta ** 2 * statisticVariance(a.pre)
  return vTrt + (numA + numB + numC) / denCtrl
}

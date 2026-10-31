import type { BaseStatistic, RegressionAdjustedStatistic, TestStatistic } from './types.js'

/**
 * Source: gbstats/models/statistics.py Statistic.mean @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function statisticMean(s: TestStatistic): number {
  throw new Error('not implemented: statisticMean')
}

/**
 * Source: gbstats/models/statistics.py Statistic.unadjusted_mean @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function statisticUnadjustedMean(s: TestStatistic): number {
  throw new Error('not implemented: statisticUnadjustedMean')
}

/**
 * Source: gbstats/models/statistics.py Statistic.variance @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function statisticVariance(s: TestStatistic): number {
  throw new Error('not implemented: statisticVariance')
}

/**
 * Source: gbstats/models/statistics.py Statistic.stddev @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function statisticStddev(s: TestStatistic): number {
  throw new Error('not implemented: statisticStddev')
}

/**
 * Source: gbstats/models/statistics.py compute_covariance @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function computeCovariance(n: number, a: BaseStatistic, b: BaseStatistic, sumOfProducts: number): number {
  throw new Error('not implemented: computeCovariance')
}

/**
 * Source: gbstats/models/statistics.py compute_theta @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function computeTheta(a: RegressionAdjustedStatistic, b: RegressionAdjustedStatistic): number {
  throw new Error('not implemented: computeTheta')
}

/**
 * Source: gbstats/models/statistics.py create_theta_adjusted_statistics @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * cupedApplied ⇔ returned pair is regressionAdjusted
 */
export function createThetaAdjustedStatistics(a: TestStatistic, b: TestStatistic): [TestStatistic, TestStatistic] {
  throw new Error('not implemented: createThetaAdjustedStatistics')
}

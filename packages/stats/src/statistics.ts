import type { BaseStatistic, RegressionAdjustedStatistic, TestStatistic } from './types.js'

/**
 * Source: gbstats/models/statistics.py Statistic.mean @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function statisticMean(s: TestStatistic): number {
  // Python's None/zero theta both mean no adjustment; n == 0 has mean 0.
  if (s.type === 'regressionAdjusted') return statisticMean(s.post) - (s.theta ?? 0) * statisticMean(s.pre)
  return s.n === 0 ? 0 : s.sum / s.n
}

/**
 * Source: gbstats/models/statistics.py Statistic.unadjusted_mean @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function statisticUnadjustedMean(s: TestStatistic): number {
  return s.type === 'regressionAdjusted' ? statisticMean(s.post) : statisticMean(s)
}

/**
 * Source: gbstats/models/statistics.py Statistic.variance @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function statisticVariance(s: TestStatistic): number {
  assertRaTypes(s)
  if (s.type === 'proportion') {
    const mean = statisticMean(s)
    return mean * (1 - mean)
  }
  // SampleMean and RA return zero at n <= 1, even with nonzero moments.
  if (s.n <= 1) return 0
  if (s.type === 'sampleMean') return (s.sumSquares - s.sum ** 2 / s.n) / (s.n - 1)
  const theta = s.theta ?? 0
  return statisticVariance(s.post) + theta ** 2 * statisticVariance(s.pre)
    - 2 * theta * computeCovariance(s.n, s.post, s.pre, s.postPreSumOfProducts)
}

/**
 * Source: gbstats/models/statistics.py Statistic.stddev @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function statisticStddev(s: TestStatistic): number {
  const variance = statisticVariance(s)
  return variance <= 0 ? 0 : Math.sqrt(variance)
}

/**
 * Source: gbstats/models/statistics.py compute_covariance @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function computeCovariance(n: number, a: BaseStatistic, b: BaseStatistic, sumOfProducts: number): number {
  if (n <= 1) return 0
  // Two proportions use /n; every other pairing uses /(n - 1).
  if (a.type === 'proportion' && b.type === 'proportion') return sumOfProducts / n - a.sum * b.sum / n ** 2
  return (sumOfProducts - a.sum * b.sum / n) / (n - 1)
}

/**
 * Source: gbstats/models/statistics.py compute_theta @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function computeTheta(a: RegressionAdjustedStatistic, b: RegressionAdjustedStatistic): number {
  assertRaTypes(a)
  assertRaTypes(b)
  const n = a.n + b.n
  const post = jointStatistic(a.post, b.post, n)
  const pre = jointStatistic(a.pre, b.pre, n)
  if (statisticVariance(pre) === 0 || statisticVariance(post) === 0) return 0
  return computeCovariance(n, post, pre, a.postPreSumOfProducts + b.postPreSumOfProducts) / statisticVariance(pre)
}

/**
 * Source: gbstats/models/statistics.py create_theta_adjusted_statistics @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * cupedApplied ⇔ returned pair is regressionAdjusted
 */
export function createThetaAdjustedStatistics(a: TestStatistic, b: TestStatistic): [TestStatistic, TestStatistic] {
  assertRaTypes(a)
  assertRaTypes(b)
  if (a.type === 'regressionAdjusted' && b.type === 'regressionAdjusted' && (a.theta === null || b.theta === null)) {
    const theta = computeTheta(a, b)
    // Only an inferred zero theta reverts to post statistics; explicit zeros stay RA.
    if (theta === 0) return [a.post, b.post]
    return [{ ...a, theta }, { ...b, theta }]
  }
  return [a, b]
}

// Python validates this at RA construction. Plain TS objects have no constructor,
// so variance, theta adjustment, computeTheta and (through adjustment) abTestMoments
// reject mismatched pre/post types here, before any early return.
function assertRaTypes(s: TestStatistic): void {
  if (s.type === 'regressionAdjusted' && s.post.type !== s.pre.type) {
    throw new TypeError('post_statistic and pre_statistic must be of the same type')
  }
}

// Source: gbstats/models/statistics.py create_joint_statistic @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
function jointStatistic(a: BaseStatistic, b: BaseStatistic, n: number): BaseStatistic {
  if (a.type === 'proportion' && b.type === 'proportion') return { type: 'proportion', n, sum: a.sum + b.sum }
  if (a.type === 'sampleMean' && b.type === 'sampleMean') {
    return { type: 'sampleMean', n, sum: a.sum + b.sum, sumSquares: a.sumSquares + b.sumSquares }
  }
  // Joint pooling preserves proportions; unlike Proportion.__add__, which returns
  // SampleMean, it must not change their covariance denominator for this one pair.
  throw new Error('Statistic types for a metric must not be different types across variations.')
}

import type { TestStatistic, BayesianConfig, BayesianTestResult, GaussianPrior } from './types.js'
import { abTestMoments } from './effectMoments.js'
import { statisticUnadjustedMean } from './statistics.js'
import { ZERO_NEGATIVE_BASELINE_VARIATION } from './internal/messages.js'
import { normalCdf, normalSf } from './internal/normal.js'
import { truncatedNormalMean } from './internal/truncatedNormal.js'
import { gaussianCredibleInterval } from './internal/utils.js'

export const DEFAULT_GAUSSIAN_PRIOR: Readonly<GaussianPrior> = Object.freeze({ mean: 0, variance: 1, proper: false })

/**
 * Source: gbstats/bayesian/tests.py EffectBayesianABTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * One theta-adjusted pair, post_stratify=False; preserves the unreachable
 * relative-test / absolute-prior rescale branch (upstream compares config to a string).
 */
export function effectBayesianABTest(a: TestStatistic, b: TestStatistic, config: BayesianConfig = {}): BayesianTestResult {
  const differenceType = config.differenceType ?? 'relative'
  const relative = differenceType === 'relative'
  const defaultOutput = (errorMessage: string): BayesianTestResult => ({
    chanceToWin: 0.5, expected: 0, ci: [0, 0], uplift: { dist: 'normal', mean: 0, stddev: 0 },
    risk: [0, 0], errorMessage, riskType: differenceType,
  })
  const moments = abTestMoments(a, b, differenceType)
  if (moments.errorMessage !== null) return defaultOutput(moments.errorMessage)

  let prior = config.priorEffect ?? DEFAULT_GAUSSIAN_PRIOR
  // Upstream's `self.relative and self.config == "absolute"` never runs:
  // config is an object. A relative test keeps even an absolute prior unchanged.
  if (!relative && (config.priorType ?? 'relative') === 'relative') {
    // Theta adjustment leaves the unadjusted (post) mean unchanged.
    const baseline = statisticUnadjustedMean(a)
    if (prior.proper && baseline === 0) return defaultOutput(ZERO_NEGATIVE_BASELINE_VARIATION)
    prior = { mean: prior.mean * Math.abs(baseline), variance: prior.variance * baseline ** 2, proper: prior.proper }
  }

  const dataMean = moments.pointEstimate
  const dataVariance = moments.standardError ** 2
  let postPrec: number
  let meanDiff: number
  // Python treats NaN as truthy; only zero selects the no-data-variance branch.
  if (dataVariance !== 0) {
    postPrec = 1 / dataVariance + (prior.proper ? 1 / prior.variance : 0)
    meanDiff = prior.proper ? (dataMean / dataVariance + prior.mean / prior.variance) / postPrec : dataMean
  } else {
    postPrec = prior.proper ? 1 / prior.variance : 0
    meanDiff = prior.proper ? prior.mean : 0
  }
  if (postPrec === 0) return defaultOutput(ZERO_NEGATIVE_BASELINE_VARIATION)
  const stdDiff = Math.sqrt(1 / postPrec)
  // scipy standardises as (x - loc) / scale before evaluating sf.
  const chanceToWin = stdDiff > 0 ? normalSf((0 - meanDiff) / stdDiff) : NaN
  const risk = getRisk(meanDiff, stdDiff)
  return {
    chanceToWin: config.inverse ? 1 - chanceToWin : chanceToWin,
    expected: meanDiff, ci: gaussianCredibleInterval(meanDiff, stdDiff, config.alpha ?? 0.05),
    uplift: { dist: 'normal', mean: meanDiff, stddev: stdDiff },
    risk: config.inverse ? [risk[1], risk[0]] : risk, riskType: differenceType, errorMessage: null,
  }
}

/** Source: gbstats/bayesian/tests.py EffectBayesianABTest.get_risk @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c */
function getRisk(mu: number, sigma: number): [number, number] {
  // Upstream avoids degenerate truncnorm calls (including scipy's silent-wrong
  // extreme-tail zone) once the normal probability rounds to zero or one.
  if (sigma > 0 && Math.abs(mu / sigma) > 37) return [Math.max(mu, 0), Math.max(-mu, 0)]
  const p = sigma > 0 ? normalCdf((0 - mu) / sigma) : NaN
  const mnNeg = truncatedNormalMean(mu, sigma, -Infinity, 0)
  const mnPos = truncatedNormalMean(mu, sigma, 0, Infinity)
  return [(1 - p) * mnPos, -(p * mnNeg)]
}

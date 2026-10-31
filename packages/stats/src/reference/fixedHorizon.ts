import type { TestStatistic, FrequentistConfig, FrequentistTestResult } from '../types.js'
import { abTestMoments } from '../effectMoments.js'
import { createThetaAdjustedStatistics, statisticVariance } from '../statistics.js'
import { tCdf, tPpf } from '../internal/studentT.js'

/**
 * Source: gbstats/frequentist/tests.py TwoSidedTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Fixed-horizon reference only; Welch dof and literal 1 - cdf (not sf).
 */
export function twoSidedTTest(a: TestStatistic, b: TestStatistic, config?: FrequentistConfig): FrequentistTestResult {
  return fixedHorizon(a, b, config, 'twoSided')
}

/**
 * Source: gbstats/frequentist/tests.py OneSidedTreatmentGreaterTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * testValue enters the critical value only, never the CI; literal 1 - cdf.
 */
export function oneSidedTreatmentGreaterTTest(a: TestStatistic, b: TestStatistic, config?: FrequentistConfig): FrequentistTestResult {
  return fixedHorizon(a, b, config, 'greater')
}

/**
 * Source: gbstats/frequentist/tests.py OneSidedTreatmentLesserTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * testValue enters the critical value only, never the CI.
 */
export function oneSidedTreatmentLesserTTest(a: TestStatistic, b: TestStatistic, config?: FrequentistConfig): FrequentistTestResult {
  return fixedHorizon(a, b, config, 'lesser')
}

// Source: gbstats/frequentist/tests.py TTest.compute_result, TTest.dof @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
function fixedHorizon(a: TestStatistic, b: TestStatistic, config: FrequentistConfig = {}, side: 'twoSided' | 'greater' | 'lesser'): FrequentistTestResult {
  const [statA, statB] = createThetaAdjustedStatistics(a, b)
  const moments = abTestMoments(statA, statB, config.differenceType ?? 'relative')
  if (moments.errorMessage) return {
    expected: 0, ci: [0, 0], pValue: 1, uplift: { dist: 'normal', mean: 0, stddev: 0 },
    errorMessage: moments.errorMessage, pValueErrorMessage: null,
  }
  const pe = moments.pointEstimate
  const se = moments.standardError
  const cv = (pe - (config.testValue ?? 0)) / se
  const varA = statisticVariance(statA)
  const varB = statisticVariance(statB)
  // Welch uses the theta-adjusted statistics, not the effect variance.
  const dof = (varB / statB.n + varA / statA.n) ** 2 / (
    varB ** 2 / (statB.n ** 2 * (statB.n - 1)) + varA ** 2 / (statA.n ** 2 * (statA.n - 1))
  )
  const alpha = config.alpha ?? 0.05
  const halfwidth = tPpf(1 - (side === 'twoSided' ? alpha / 2 : alpha), dof) * se
  const pValue = side === 'twoSided' ? 2 * (1 - tCdf(Math.abs(cv), dof))
    : side === 'greater' ? 1 - tCdf(cv, dof) : tCdf(cv, dof)
  return {
    expected: pe,
    ci: side === 'twoSided' ? [pe - halfwidth, pe + halfwidth]
      : side === 'greater' ? [pe - halfwidth, Infinity] : [-Infinity, pe + halfwidth],
    pValue, uplift: { dist: 'normal', mean: pe, stddev: se }, errorMessage: null, pValueErrorMessage: null,
  }
}

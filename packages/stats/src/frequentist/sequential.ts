import type { TestStatistic, SequentialConfig, FrequentistTestResult } from '../types.js'
import { abTestMoments } from '../effectMoments.js'
import { createThetaAdjustedStatistics } from '../statistics.js'

/**
 * Source: gbstats/frequentist/tests.py SequentialTwoSidedTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Eq 155 uses min(1 / evalue, 1) literally, including exp overflow to Infinity.
 * testValue affects pValue only, never the CI. No Welch dof or t CDF is used
 * by sequential tests (the fixed-horizon reference keeps Welch and 1 - cdf).
 */
export function sequentialTwoSidedTTest(a: TestStatistic, b: TestStatistic, config?: SequentialConfig): FrequentistTestResult {
  return sequentialTest(a, b, config, 'twoSided')
}

/**
 * Source: gbstats/frequentist/tests.py SequentialOneSidedTreatmentGreaterTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * One-sided pValue is a clamped diagnostic in [1e-5, 0.4999] or null,
 * ignores testValue; decide from ci, never from pValue.
 */
export function sequentialOneSidedTreatmentGreaterTTest(a: TestStatistic, b: TestStatistic, config?: SequentialConfig): FrequentistTestResult {
  return sequentialTest(a, b, config, 'greater')
}

/**
 * Source: gbstats/frequentist/tests.py SequentialOneSidedTreatmentLesserTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * One-sided pValue is a clamped diagnostic in [1e-5, 0.4999] or null,
 * ignores testValue; decide from ci, never from pValue.
 */
export function sequentialOneSidedTreatmentLesserTTest(a: TestStatistic, b: TestStatistic, config?: SequentialConfig): FrequentistTestResult {
  return sequentialTest(a, b, config, 'lesser')
}

/**
 * Source: gbstats/frequentist/tests.py sequential_rho @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Eq 161: the one-sided alpha argument is 2 * alpha.
 */
export function sequentialRho(alpha: number, sequentialTuningParameter: number, twoSided = true): number {
  const alphaArg = twoSided ? alpha : 2 * alpha
  return Math.sqrt((-2 * Math.log(alphaArg) + Math.log(-2 * Math.log(alphaArg) + 1)) / sequentialTuningParameter)
}

/**
 * Source: gbstats/frequentist/tests.py sequential_interval_halfwidth @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Eq 9; an explicit rho is retained, otherwise use the two-sided rho.
 */
export function sequentialIntervalHalfwidth(s2: number, n: number, sequentialTuningParameter: number, alpha: number, rho?: number): number {
  rho ??= sequentialRho(alpha, sequentialTuningParameter, true)
  return Math.sqrt(s2) * Math.sqrt(
    (2 * (n * rho ** 2 + 1)) * Math.log(Math.sqrt(n * rho ** 2 + 1) / alpha) / (n * rho) ** 2,
  )
}

/**
 * Source: gbstats/frequentist/tests.py sequential_interval_halfwidth_one_sided @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Eq 134; an explicit rho is retained, otherwise use the one-sided rho.
 */
export function sequentialIntervalHalfwidthOneSided(s2: number, n: number, sequentialTuningParameter: number, alpha: number, rho?: number): number {
  rho ??= sequentialRho(alpha, sequentialTuningParameter, false)
  const part1 = s2
  const part2 = 2 * (n * rho ** 2 + 1) / (n * rho) ** 2
  const part3 = Math.log(1 + Math.sqrt(n * rho ** 2 + 1) / (2 * alpha))
  return Math.sqrt(part1 * part2 * part3)
}

/**
 * Source: gbstats/utils.py is_statistically_significant @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Python raises for a None comparison; our nullable API treats null as not
 * significant on that side. Actual sequential open ends are numeric infinities.
 */
export function isStatisticallySignificant(ci: readonly [number | null, number | null]): boolean {
  return (ci[0] !== null && ci[0] > 0) || (ci[1] !== null && ci[1] < 0)
}

type Side = 'twoSided' | 'greater' | 'lesser'
type PValueResult = Pick<FrequentistTestResult, 'pValue' | 'pValueErrorMessage'>

// Source: gbstats/frequentist/tests.py SequentialTTest.__init__ @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
function sequentialState(a: TestStatistic, b: TestStatistic, config: SequentialConfig, side: Side) {
  const [statA, statB] = createThetaAdjustedStatistics(a, b)
  const moments = abTestMoments(statA, statB, config.differenceType ?? 'relative')
  const alpha = config.alpha ?? 0.05
  const tuning = config.sequentialTuningParameter ?? 5000
  const rho = config.rho ?? sequentialRho(alpha, tuning, side === 'twoSided')
  // n comes from the theta-adjusted stats, not the unadjusted input pair.
  const n = statA.n + statB.n
  return { statA, statB, moments, alpha, tuning, rho, n }
}

// Source: gbstats/frequentist/tests.py Sequential*Test.confidence_interval, one_sided_confidence_interval @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
function confidenceInterval(state: ReturnType<typeof sequentialState>, side: Side): [number, number] {
  const { moments, n, tuning, alpha, rho } = state
  const pe = moments.pointEstimate
  const s2 = moments.standardError ** 2 * n
  const hw = side === 'twoSided' ? sequentialIntervalHalfwidth(s2, n, tuning, alpha, rho)
    : sequentialIntervalHalfwidthOneSided(s2, n, tuning, alpha, rho)
  // testValue never enters a CI, including the inner bisection CIs.
  return side === 'twoSided' ? [pe - hw, pe + hw]
    : side === 'lesser' ? [-Infinity, pe + hw] : [pe - hw, Infinity]
}

// Source: gbstats/frequentist/tests.py TTest._default_output @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
function defaultOutput(errorMessage: string | null, pValueErrorMessage: FrequentistTestResult['pValueErrorMessage'] = null): FrequentistTestResult {
  return {
    expected: 0, ci: [0, 0], pValue: 1, uplift: { dist: 'normal', mean: 0, stddev: 0 },
    errorMessage, pValueErrorMessage,
  }
}

// Source: gbstats/frequentist/tests.py TTest.compute_result, SequentialTwoSidedTTest.p_value @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
function sequentialTest(a: TestStatistic, b: TestStatistic, config: SequentialConfig = {}, side: Side): FrequentistTestResult {
  const state = sequentialState(a, b, config, side)
  const { moments, alpha, rho, n } = state
  // Preserve precedence: moments error before the one-sided alpha >= 0.5 guard.
  if (moments.errorMessage) return defaultOutput(moments.errorMessage)
  if (side !== 'twoSided' && alpha >= 0.5) {
    return defaultOutput(null, 'ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST')
  }
  const pe = moments.pointEstimate
  const se = moments.standardError
  let pResult: PValueResult
  if (side === 'twoSided') {
    // Eq 155, reparameterised exactly as upstream. Keep expression order:
    // numpy exp overflow gives Infinity, then 1 / Infinity gives pValue = 0.
    const st2 = (pe - (config.testValue ?? 0)) ** 2 * n / se ** 2
    const tr2p1 = n * rho ** 2 + 1
    const evalue = Math.exp(rho ** 2 * st2 / (2 * tr2p1)) / Math.sqrt(tr2p1)
    pResult = { pValue: Math.min(1 / evalue, 1), pValueErrorMessage: null }
  } else {
    pResult = oneSidedPValue(state, config, side)
  }
  return {
    expected: pe, ci: confidenceInterval(state, side), ...pResult,
    uplift: { dist: 'normal', mean: pe, stddev: se }, errorMessage: null,
  }
}

// Source: gbstats/frequentist/tests.py SequentialOneSidedTreatmentLesserTTest.compute_p_value @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
function oneSidedPValue(state: ReturnType<typeof sequentialState>, config: SequentialConfig, side: 'lesser' | 'greater'): PValueResult {
  const lesser = side === 'lesser'
  const tol = 1e-6
  const maxIters = 100
  let minAlpha = 1e-5
  let maxAlpha = 0.4999
  // Inner configs drop test_value (default 0), retain the OUTER one-sided rho
  // as alpha varies, and default tuning to 5000. No scaled difference type here.
  const innerConfig: SequentialConfig = {
    differenceType: config.differenceType ?? 'relative', alpha: minAlpha, rho: state.rho,
  }
  const ciIndex = lesser ? 1 : 0
  const innerCI = () => confidenceInterval(sequentialState(state.statA, state.statB, innerConfig, side), side)
  const ciSmallValue = innerCI()[ciIndex]
  if (lesser) {
    if (ciSmallValue < 0) return { pValue: minAlpha, pValueErrorMessage: null }
    innerConfig.alpha = maxAlpha
    const ciBigValue = innerCI()[ciIndex]
    if (ciBigValue > 0) return { pValue: maxAlpha, pValueErrorMessage: null }
  } else {
    if (ciSmallValue > 0) return { pValue: minAlpha, pValueErrorMessage: null }
    innerConfig.alpha = maxAlpha
    const ciBigValue = innerCI()[ciIndex]
    if (ciBigValue < 0) return { pValue: maxAlpha, pValueErrorMessage: null }
  }
  // Upstream never increments iters: convergence is solely |diff| < tol.
  // At CI magnitudes >= 1e10, convergence depends on float rounding because
  // upstream uses a fixed 1e-6 tolerance; this is inherited, not a port difference.
  const iters: number = 0
  let thisAlpha = 0.5 * (minAlpha + maxAlpha)
  let diff = 0
  for (let i = 0; i < maxIters; i++) {
    innerConfig.alpha = thisAlpha
    const ciValue = innerCI()[ciIndex]
    // Upstream's `if ci_value is None: break` is unreachable here: CI bounds
    // are numbers (including NaN and +/-Infinity), so that check is omitted.
    diff = ciValue - 0
    if (lesser) {
      if (diff > 0) minAlpha = thisAlpha
      else maxAlpha = thisAlpha
    } else {
      if (diff < 0) minAlpha = thisAlpha
      else maxAlpha = thisAlpha
    }
    // Return the post-update midpoint, even when the pre-update diff converged.
    thisAlpha = 0.5 * (minAlpha + maxAlpha)
    if (Math.abs(diff) < tol) break
  }
  const converged = Math.abs(diff) < tol && iters !== maxIters
  return converged ? { pValue: thisAlpha, pValueErrorMessage: null }
    : { pValue: null, pValueErrorMessage: 'NUMERICAL_PVALUE_NOT_CONVERGED' }
}

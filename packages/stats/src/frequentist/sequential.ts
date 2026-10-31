import type { TestStatistic, SequentialConfig, FrequentistTestResult } from '../types.js'

/**
 * Source: gbstats/frequentist/tests.py SequentialTwoSidedTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function sequentialTwoSidedTTest(a: TestStatistic, b: TestStatistic, config?: SequentialConfig): FrequentistTestResult {
  throw new Error('not implemented: sequentialTwoSidedTTest')
}

/**
 * Source: gbstats/frequentist/tests.py SequentialOneSidedTreatmentGreaterTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function sequentialOneSidedTreatmentGreaterTTest(a: TestStatistic, b: TestStatistic, config?: SequentialConfig): FrequentistTestResult {
  throw new Error('not implemented: sequentialOneSidedTreatmentGreaterTTest')
}

/**
 * Source: gbstats/frequentist/tests.py SequentialOneSidedTreatmentLesserTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * one-sided pValue is a clamped [1e-5, 0.4999] diagnostic or null and ignores testValue: decide from ci, never from pValue
 */
export function sequentialOneSidedTreatmentLesserTTest(a: TestStatistic, b: TestStatistic, config?: SequentialConfig): FrequentistTestResult {
  throw new Error('not implemented: sequentialOneSidedTreatmentLesserTTest')
}

/**
 * Source: gbstats/frequentist/tests.py sequential_rho @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function sequentialRho(alpha: number, sequentialTuningParameter: number, twoSided?: boolean): number {
  throw new Error('not implemented: sequentialRho')
}

/**
 * Source: gbstats/frequentist/tests.py sequential_interval_halfwidth @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function sequentialIntervalHalfwidth(s2: number, n: number, sequentialTuningParameter: number, alpha: number, rho?: number): number {
  throw new Error('not implemented: sequentialIntervalHalfwidth')
}

/**
 * Source: gbstats/frequentist/tests.py sequential_interval_halfwidth_one_sided @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function sequentialIntervalHalfwidthOneSided(s2: number, n: number, sequentialTuningParameter: number, alpha: number, rho?: number): number {
  throw new Error('not implemented: sequentialIntervalHalfwidthOneSided')
}

/**
 * Source: gbstats/utils.py is_statistically_significant @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * utils.py
 */
export function isStatisticallySignificant(ci: readonly [number | null, number | null]): boolean {
  throw new Error('not implemented: isStatisticallySignificant')
}

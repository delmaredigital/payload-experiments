import type { TestStatistic, FrequentistConfig, FrequentistTestResult } from '../types.js'

/**
 * Source: gbstats/frequentist/tests.py TwoSidedTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function twoSidedTTest(a: TestStatistic, b: TestStatistic, config?: FrequentistConfig): FrequentistTestResult {
  throw new Error('not implemented: twoSidedTTest')
}

/**
 * Source: gbstats/frequentist/tests.py OneSidedTreatmentGreaterTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function oneSidedTreatmentGreaterTTest(a: TestStatistic, b: TestStatistic, config?: FrequentistConfig): FrequentistTestResult {
  throw new Error('not implemented: oneSidedTreatmentGreaterTTest')
}

/**
 * Source: gbstats/frequentist/tests.py OneSidedTreatmentLesserTTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function oneSidedTreatmentLesserTTest(a: TestStatistic, b: TestStatistic, config?: FrequentistConfig): FrequentistTestResult {
  throw new Error('not implemented: oneSidedTreatmentLesserTTest')
}

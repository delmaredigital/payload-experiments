import type { TestStatistic, DifferenceType, EffectMomentsResult } from './types.js'

/**
 * Source: gbstats/models/tests.py BaseABTest.compute_moments_result @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * theta adjustment + EffectMoments
 */
export function abTestMoments(a: TestStatistic, b: TestStatistic, differenceType?: DifferenceType): EffectMomentsResult {
  throw new Error('not implemented: abTestMoments')
}

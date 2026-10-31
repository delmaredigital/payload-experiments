import type { TestStatistic, BayesianConfig, BayesianTestResult, GaussianPrior } from './types.js'

export const DEFAULT_GAUSSIAN_PRIOR: Readonly<GaussianPrior> = Object.freeze({ mean: 0, variance: 1, proper: false })

/**
 * Source: gbstats/bayesian/tests.py EffectBayesianABTest @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function effectBayesianABTest(a: TestStatistic, b: TestStatistic, config?: BayesianConfig): BayesianTestResult {
  throw new Error('not implemented: effectBayesianABTest')
}

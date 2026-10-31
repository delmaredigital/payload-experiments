import type { DifferenceType, EffectMomentsResult, MidExperimentPowerConfig, AdditionalSampleSizeNeededResult } from '../types.js'
import { DEFAULT_GAUSSIAN_PRIOR } from '../bayesian.js'
import { sequentialIntervalHalfwidth } from '../frequentist/sequential.js'
import { normalCdf, normalPpf } from '../internal/normal.js'

/**
 * Source: gbstats/power/midexperimentpower.py MidExperimentPower.calculate_sample_size @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Already powered ⇔ scalingFactor === 0 && updateMessage === 'successful';
 * upstream's falsy check leaves additionalUsers null. additionalUsers is pairwise
 * (both compared arms). Throws Error with upstream's ValueError payload list
 * when the bisection does not converge.
 */
export function midExperimentPower(moments: EffectMomentsResult, testResult: { errorMessage: string | null }, config: { alpha?: number; differenceType?: DifferenceType }, powerConfig: MidExperimentPowerConfig = {}): AdditionalSampleSizeNeededResult {
  const alpha = config.alpha ?? 0.05
  // Upstream stores relative but never uses it in the power calculation.
  const numGoalMetrics = powerConfig.numGoalMetrics ?? 1
  const numTests = powerConfig.pValueCorrected ? ((powerConfig.numVariations ?? 2) - 1) * numGoalMetrics : 1
  // Upstream's __init__ divides by num_tests (multiplier) and by num_goal_metrics
  // (adjusted_power) before anything else, raising ZeroDivisionError; JS would
  // silently produce Infinity/0 and a confident "already powered" result.
  if (numTests === 0) throw new RangeError('numTests is 0 (pValueCorrected with numVariations 1 or numGoalMetrics 0)')
  if (numGoalMetrics === 0) throw new RangeError('numGoalMetrics must not be 0')
  const multiplier = normalPpf(1 - alpha / (2 * numTests))
  const targetPower = powerConfig.targetPower ?? 0.8
  const adjustedPower = targetPower ** (1 / numGoalMetrics)
  const targetMde = Math.abs(powerConfig.targetMde ?? 0.01)
  const prior = powerConfig.priorEffect === undefined ? DEFAULT_GAUSSIAN_PRIOR : powerConfig.priorEffect
  const pairwiseSampleSize = moments.pairwiseSampleSize
  const sigmahat2Delta = testResult.errorMessage !== null ? 0 : moments.standardError ** 2

  if (testResult.errorMessage) {
    return { error: testResult.errorMessage, updateMessage: 'unsuccessful', additionalUsers: 0,
      scalingFactor: null, upperBoundAchieved: false, targetPower }
  }

  function power(scalingFactor: number): number {
    const ntPrime = scalingFactor * pairwiseSampleSize
    const adjustedVariance = sigmahat2Delta / (1 + scalingFactor)
    const den = adjustedVariance ** 0.5
    let partPos: number
    let partNeg: number
    if (prior && prior.proper) {
      const posteriorPrecision = 1 / prior.variance + 1 / adjustedVariance
      const num1 = adjustedVariance * posteriorPrecision ** 0.5 * multiplier
      const num2 = adjustedVariance * prior.mean / prior.variance
      partPos = 1 - normalCdf((num1 - num2 - targetMde) / den)
      partNeg = normalCdf(-(num1 + num2 + targetMde) / den)
    } else {
      const halfwidth = powerConfig.sequential
        ? sequentialIntervalHalfwidth(pairwiseSampleSize * sigmahat2Delta, pairwiseSampleSize + ntPrime,
          powerConfig.sequentialTuningParameter ?? 5000, alpha / numTests)
        : multiplier * adjustedVariance ** 0.5
      partPos = 1 - normalCdf((halfwidth - targetMde) / den)
      partNeg = normalCdf(-(halfwidth + targetMde) / den)
    }
    return partPos + partNeg
  }

  if (power(0) > adjustedPower) {
    return { error: null, updateMessage: 'successful', additionalUsers: null,
      scalingFactor: 0, upperBoundAchieved: false, targetPower }
  }
  let scalingFactor = 1
  let currentPower = power(scalingFactor)
  for (let i = 0; i < 27; i++) {
    if (currentPower < adjustedPower) {
      scalingFactor *= 2
      currentPower = power(scalingFactor)
    } else break
  }
  if (currentPower < adjustedPower) {
    return { error: 'could not find upper bound for scaling factor', updateMessage: 'unsuccessful',
      additionalUsers: null, scalingFactor: null, upperBoundAchieved: true, targetPower }
  }

  let lower = 0
  let upper = scalingFactor
  let diff = currentPower - adjustedPower
  let iteration = 0
  for (; iteration < 100; iteration++) {
    // Preserve upstream's bound update BEFORE evaluating the new midpoint.
    if (diff > 0) upper = scalingFactor
    else lower = scalingFactor
    scalingFactor = 0.5 * (lower + upper)
    currentPower = power(scalingFactor)
    diff = currentPower - adjustedPower
    if (Math.abs(diff) < 1e-5) break
  }
  const converged = iteration < 99
  if (!converged) {
    throw new Error(`[${[currentPower, adjustedPower, diff, scalingFactor, lower, upper].join(', ')}]`)
  }
  return { error: null, updateMessage: 'successful',
    additionalUsers: scalingFactor ? pairwiseSampleSize * scalingFactor : null,
    scalingFactor, upperBoundAchieved: false, targetPower }
}

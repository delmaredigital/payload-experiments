import { abTestMoments, midExperimentPower, sequentialTwoSidedTTest } from '@delmaredigital/experiments-stats'
import type { GaussianPrior, TestStatistic } from '@delmaredigital/experiments-stats'
import type { Snapshot } from '../types/snapshot.js'

/** Present the stats engine's pairwise sample estimate at observed exposed-unit
 * traffic. v1 planning uses 10% relative lift and 80% power (as Review does).
 * Called for running test verdict rows 4 and 9; rollout and concluded tests omit estimates.
 */
export function remainingPower(input: {
  baseline: TestStatistic; variants: readonly TestStatistic[]; elapsedDays: number
  alpha: number; method: Snapshot['method']; sequentialTuningParameter: number; prior: GaussianPrior
}): Snapshot['power'] {
  const lowerBound = input.method === 'sequential'
  const unknown: Snapshot['power'] = { daysRemaining: null, exposuresNeededPerArm: null, lowerBound, feasible: true }
  if (input.elapsedDays <= 0 || input.variants.length === 0) return unknown
  const estimates = input.variants.map(variant => {
    const moments = abTestMoments(input.baseline, variant)
    const result = sequentialTwoSidedTTest(input.baseline, variant, {
      alpha: input.alpha, sequentialTuningParameter: input.sequentialTuningParameter,
    })
    if (moments.errorMessage) return null
    try {
      return { result: midExperimentPower(moments, result, { alpha: input.alpha }, {
        targetMde: 0.1, targetPower: 0.8, sequential: lowerBound,
        sequentialTuningParameter: input.sequentialTuningParameter,
        priorEffect: input.method === 'bayesian' ? input.prior : null,
      }), n: moments.pairwiseSampleSize }
    } catch { return null }
  })
  if (estimates.some(estimate => estimate === null)) return unknown
  if (estimates.some(estimate => estimate!.result.updateMessage === 'unsuccessful')) return { ...unknown, feasible: false }
  let daysRemaining = 0
  let exposuresNeededPerArm = 0
  for (const estimate of estimates) {
    const { result, n } = estimate!
    const additional = result.scalingFactor === 0 ? 0 : result.additionalUsers
    if (additional === null || !Number.isFinite(additional)) return unknown
    daysRemaining = Math.max(daysRemaining, Math.ceil(additional / (n / input.elapsedDays)))
    // Upstream additionalUsers is pairwise, so the UI's per-arm total is half
    // the projected pair. Day estimates preserve the actual observed arm ratio.
    exposuresNeededPerArm = Math.max(exposuresNeededPerArm, Math.ceil((n + additional) / 2))
  }
  return { daysRemaining, exposuresNeededPerArm, lowerBound, feasible: daysRemaining <= 90 }
}

import type { VariationRange } from '../types.js'
import { chooseVariation, getBucketRanges, hash } from './sdk.js'

/**
 * Source: spec §6.1 (composed helper)
 * throws unless non-negative integers summing to exactly 100; w/100
 * armWeightsToFractions(w): throws RangeError unless every weight is a non-negative integer
 * and the sum is exactly 100; returns w.map(x => x / 100).
 * SDK composition source: sdk-js/src/util.ts @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function armWeightsToFractions(weights: readonly number[]): number[] {
  if (!weights.every(x => Number.isInteger(x) && x >= 0) || weights.reduce((sum, x) => sum + x, 0) !== 100) {
    throw new RangeError('Arm weights must be non-negative integers summing to 100')
  }
  return weights.map(x => x / 100)
}

/**
 * Source: spec §6.1 (composed from SDK hash/getBucketRanges/chooseVariation)
 * SDK source: sdk-js/src/util.ts @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * throws RangeError unless seed.endsWith('|'); returns
 * chooseVariation(hash(seed, unitId, 2)!, getBucketRanges(weights.length, coverage, armWeightsToFractions(weights))); throws unless seed ends in '|'
 */
export function assignArm(args: { seed: string; unitId: string; weights: readonly number[]; coverage: number }): number {
  const { seed, unitId, weights, coverage } = args
  if (!seed.endsWith('|')) throw new RangeError('Assignment seed must end in |')
  return chooseVariation(hash(seed, unitId, 2)!, getBucketRanges(weights.length, coverage, armWeightsToFractions(weights)))
}

/**
 * Source: spec §5.3 (composed from SDK hash)
 * SDK source: sdk-js/src/util.ts @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Math.floor(hash(layerSlug + '|', unitId, 2)! * 100) ∈ [0, 99]; the only implementation (SQL never recomputes slices)
 */
export function layerSlice(layerSlug: string, unitId: string): number {
  return Math.floor(hash(layerSlug + '|', unitId, 2)! * 100)
}

/**
 * Source: spec §7.6/§8.1.5 (composed from SDK getBucketRanges)
 * SDK source: sdk-js/src/util.ts @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * After armWeightsToFractions validation, throws RangeError if testWeights.length < 2 or the last weight is 0.
 * ranges = getBucketRanges(n, coverage, armWeightsToFractions(testWeights)); holdout = ranges[n−1] unchanged; winner = [0, coverage * holdout[0]].
 * testWeights = the TEST phase's integer weights, holdout last (h = last weight; throws if fewer than 2 arms or h = 0).
 * holdout = getBucketRanges(n, coverage, testWeights/100)[n−1] VERBATIM (bit-identical membership before/after decide);
 * winner  = [0, coverage · holdoutStart) where holdoutStart = holdout[0] (disjoint by construction); SRM weights {100−h, h}
 * (spec §7.6/§8.1.5 as amended by exp-orch X1)
 */
export function rolloutBucketRanges(testWeights: readonly number[], coverage: number): { winner: VariationRange; holdout: VariationRange } {
  const fractions = armWeightsToFractions(testWeights)
  const n = testWeights.length
  if (n < 2 || testWeights[n - 1] === 0) throw new RangeError('Rollout requires at least two arms and a positive last weight')
  const ranges = getBucketRanges(n, coverage, fractions)
  const holdout = ranges[n - 1]!
  const winner: VariationRange = [0, coverage * holdout[0]]
  return { winner, holdout }
}

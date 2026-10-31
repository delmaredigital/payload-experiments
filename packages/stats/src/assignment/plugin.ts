import type { VariationRange } from '../types.js'

/**
 * Source: spec §6.1 (composed helper)
 * throws unless non-negative integers summing to exactly 100; w/100
 */
export function armWeightsToFractions(weights: readonly number[]): number[] {
  throw new Error('not implemented: armWeightsToFractions')
}

/**
 * Source: spec §6.1 (composed from SDK hash/getBucketRanges/chooseVariation)
 * chooseVariation(hash(seed, unitId, 2)!, getBucketRanges(weights.length, coverage, armWeightsToFractions(weights))); throws unless seed ends in '|'
 */
export function assignArm(args: { seed: string; unitId: string; weights: readonly number[]; coverage: number }): number {
  throw new Error('not implemented: assignArm')
}

/**
 * Source: spec §5.3 (composed from SDK hash)
 * Math.floor(hash(layerSlug + '|', unitId, 2)! * 100) ∈ [0, 99]; the only implementation (SQL never recomputes slices)
 */
export function layerSlice(layerSlug: string, unitId: string): number {
  throw new Error('not implemented: layerSlice')
}

/**
 * Source: spec §7.6/§8.1.5 (composed from SDK getBucketRanges)
 * testWeights = the TEST phase's integer weights, holdout last (h = last weight; throws if fewer than 2 arms or h = 0).
 * holdout = getBucketRanges(n, coverage, testWeights/100)[n−1] VERBATIM (bit-identical membership before/after decide);
 * winner  = [0, coverage · holdoutStart) where holdoutStart = holdout[0] (disjoint by construction); SRM weights {100−h, h}
 * (spec §7.6/§8.1.5 as amended by exp-orch X1)
 */
export function rolloutBucketRanges(testWeights: readonly number[], coverage: number): { winner: VariationRange; holdout: VariationRange } {
  throw new Error('not implemented: rolloutBucketRanges')
}

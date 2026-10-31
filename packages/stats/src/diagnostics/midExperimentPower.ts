import type { DifferenceType, EffectMomentsResult, MidExperimentPowerConfig, AdditionalSampleSizeNeededResult } from '../types.js'

/**
 * Source: gbstats/power/midexperimentpower.py MidExperimentPower @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * throws Error (upstream ValueError payload) when the bisection does not converge
 */
export function midExperimentPower(moments: EffectMomentsResult, testResult: { errorMessage: string | null }, config: { alpha?: number; differenceType?: DifferenceType }, powerConfig?: MidExperimentPowerConfig): AdditionalSampleSizeNeededResult {
  throw new Error('not implemented: midExperimentPower')
}

import type { Arm, ExperimentKind, ExposurePolicy } from '../../../types/contracts.js'
import type { PreflightResult } from '../../../types/endpoints.js'

const ORDER = ['control', 'variantA', 'variantB', 'variantC', 'holdout']
export function orderedVersions(arms: readonly Arm[]): Array<{ arm: Arm; index: number }> {
  return arms.map((arm, index) => ({ arm, index })).sort((a, b) => ORDER.indexOf(a.arm.key) - ORDER.indexOf(b.arm.key))
}
/** Normalised visual shares only; invalid saved weights still surface as validation issues. */
export function trafficShares(arms: readonly Arm[]): number[] {
  const weights = arms.map(arm => Number.isFinite(arm.weight) ? Math.max(0, arm.weight) : 0)
  const sum = weights.reduce((a, b) => a + b, 0)
  return weights.map(weight => sum ? weight / sum * 100 : 0)
}
export function durationSuggestion(preflight: PreflightResult | null, savedDays?: number | null) {
  const estimate = preflight?.estimate
  return estimate && estimate.plannedDurationDays !== savedDays ? estimate : null
}
export function exposureOptions(kind: ExperimentKind): readonly ExposurePolicy[] {
  return kind === 'block' ? ['render', 'viewport'] : kind === 'page' ? ['pageview'] : ['manual']
}

export { balanceWeight } from '../../../arms/model.js'

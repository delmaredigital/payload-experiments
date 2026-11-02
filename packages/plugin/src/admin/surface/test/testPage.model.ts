import { setWeight } from '../../arms/arms.model.js'
import type { Arm, ArmKey, ExperimentKind, ExposurePolicy } from '../../../types/contracts.js'
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

/** Keep the edited share exact and distribute the remaining whole percentages proportionally. */
export function balanceWeight(arms: Arm[], key: ArmKey, weight: number): Arm[] {
  if (!arms.some(arm => arm.key === key) || !Number.isInteger(weight) || weight < 0 || weight > 100) return arms
  const others = arms.filter(arm => arm.key !== key)
  if (!others.length) return arms
  const total = others.reduce((sum, arm) => sum + Math.max(0, Number.isFinite(arm.weight) ? arm.weight : 0), 0)
  const denominator = total || others.length
  const raw = others.map(arm => (total ? Math.max(0, Number.isFinite(arm.weight) ? arm.weight : 0) : 1) * (100 - weight) / denominator)
  const whole = raw.map(Math.floor)
  const order = raw.map((_, i) => i).sort((a, b) => raw[b]! - whole[b]! - (raw[a]! - whole[a]!) || a - b)
  const remainder = 100 - weight - whole.reduce((sum, value) => sum + value, 0)
  for (let i = 0; i < remainder; i++) whole[order[i]!]!++
  const shares = new Map(others.map((arm, i) => [arm.key, whole[i]!]))
  return setWeight(arms, key, weight).map(arm => shares.has(arm.key) ? { ...arm, weight: shares.get(arm.key)! } : arm)
}

import { XpAnalysisError } from '../errors.js'
import { checkSrm } from '@delmaredigital/experiments-stats'
import type { Snapshot } from '../types/snapshot.js'

/** SRM uses exposed units and renormalised frozen weights, never allocation or
 * assignment counts. Rollout callers pass only shipped/holdout weights (100-h,h).
 * Zero-weight arms are omitted from checkSrm as required by its public contract.
 */
export function exposureSrm(
  arms: readonly { key: string; weight: number }[], perArm: Readonly<Record<string, number>>,
): Snapshot['srm'] {
  const active = arms.filter(arm => arm.weight > 0)
  const weight = active.reduce((sum, arm) => sum + arm.weight, 0)
  if (weight <= 0) throw new XpAnalysisError('srm-weights')
  const expected = Object.fromEntries(arms.map(arm => [arm.key, arm.weight / weight]))
  // A unit exposed to an impossible arm is a splitting problem even though
  // checkSrm deliberately omits zero-weight groups from its degrees of freedom.
  const impossible = arms.some(arm => arm.weight === 0 && (perArm[arm.key] ?? 0) > 0)
  const p = impossible ? 0 : active.length < 2 ? 1
    : checkSrm(active.map(arm => perArm[arm.key] ?? 0), active.map(arm => arm.weight))
  return { p, flagged: p < 0.001, expected }
}

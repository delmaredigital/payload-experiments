import type { PhaseSummary } from '../../types/endpoints.js'
import { RESULTS_COPY, shippingTitle } from '../copy/results.js'
import { armLabel } from '../labels.js'
import type { ResultsContext } from './results.model.js'
import type { LegacySnapshot } from './snapshot.js'

/** Stands in for CORE-15a winnerArm, borrowing the live decision only for the newest rollout. */
export function legacyRolloutLine(snapshot: LegacySnapshot, phase: PhaseSummary, phases: PhaseSummary[], decision?: { winnerArm?: string }): string {
  const newestRollout = phases.filter(phase => phase.phaseKind === 'rollout').reduce<number | null>(
    (latest, phase) => latest === null || phase.phase > latest ? phase.phase : latest, null,
  )
  const winner = snapshot.winnerArm ?? (snapshot.phase === newestRollout ? decision?.winnerArm : undefined)
  return shippingTitle(winner ? phase.arms.find(arm => arm.key === winner)?.label ?? armLabel(winner) : RESULTS_COPY.shippedGroup)
}

/** Stands in for CORE-15a minExposuresPerArm; absent historical minima keep the old dash. */
export function legacyMinimum(snapshot: LegacySnapshot, ctx: ResultsContext): number | undefined {
  return snapshot.minExposuresPerArm ?? ctx.minExposuresPerArm
}

/** Stands in for CORE-15a minExposuresPerArm by deriving the old notice from the frozen verdict. */
export function legacyTooFew(snapshot: LegacySnapshot): boolean {
  return snapshot.verdict.code === 'collecting' || snapshot.verdict.code === 'rollout-collecting'
}

/** Stands in for CORE-15a winnerArm in rollout recommendations using the old recommended arm and label. */
export function legacyRecommendationWinner(snapshot: LegacySnapshot, phase?: PhaseSummary): { key: string | null; label: string } {
  const key = snapshot.winnerArm ?? snapshot.verdict.recommendedArm
  const stored = phase?.arms.find(arm => arm.key === key)?.label.trim()
  return { key, label: stored || (key && ['control', 'variantA', 'variantB', 'variantC', 'holdout'].includes(key) ? armLabel(key) : RESULTS_COPY.shippedGroup) }
}

import type { PhaseSummary } from '../../../types/endpoints.js'
import type { Status } from '../../../types/contracts.js'
import type { VerdictCode } from '../../../types/snapshot.js'
import { formatDate } from '../../format/date.js'
import { armLabel } from '../../labels.js'
import { formatCount, formatPercent } from '../../results/format.js'
import { RESULTS_COPY } from '../../copy/results.js'
import { legacyRecommendationWinner } from '../../results/legacy.js'
import { isLegacySnapshot, type DisplaySnapshot } from '../../results/snapshot.js'
import {
  RECOMMENDATION_COPY as C, collectingRecommendation, guardrailRecommendation, mixedRecommendation,
  rolloutCollectingRecommendation, rolloutReadoutRecommendation, runningRecommendation, winnerRecommendation, worseRecommendation, storedGuardrailFinding,
} from '../../copy/recommendation.js'

export interface RecommendationContext {
  snapshot: DisplaySnapshot
  phase?: PhaseSummary
  plannedDurationDays?: number | null
  status?: Status
}
function label(ctx: RecommendationContext, key: string | null | undefined, fallback = C.group as string): string {
  const stored = ctx.phase?.arms.find(arm => arm.key === key)?.label.trim()
  return stored || (key && ['control', 'variantA', 'variantB', 'variantC', 'holdout'].includes(key) ? armLabel(key) : fallback)
}
const primary = ({ snapshot }: RecommendationContext) => snapshot.metrics.find(metric => metric.role === 'primary')
const worse = (ctx: RecommendationContext) => primary(ctx)?.comparisons.find(comparison => comparison.significant === 'worse'
  && ctx.phase?.arms.some(arm => arm.key === comparison.arm && arm.kind === 'variant'))?.arm
const rolloutWinner = (ctx: RecommendationContext) => isLegacySnapshot(ctx.snapshot)
  ? legacyRecommendationWinner(ctx.snapshot, ctx.phase)
  : { key: ctx.snapshot.winnerArm, label: label(ctx, ctx.snapshot.winnerArm) }

/** Select stored findings and format them; never run inference in the admin. */
export const RECOMMENDATION: Record<VerdictCode, (ctx: RecommendationContext) => string> = {
  unavailable: () => C.unavailable,
  'data-problem': () => C.dataProblem,
  'guardrail-failing': ctx => {
    const guardrail = ctx.snapshot.guardrails.find(guardrail => guardrail.status === 'failing')
    const metric = ctx.snapshot.metrics.find(metric => metric.metricId === guardrail?.metricId)
    // Guardrail safety uses one-sided tests, distinct from comparison significance.
    // Select the group the server named; do not re-infer harm from the table.
    const group = ctx.phase?.arms.find(arm => ctx.snapshot.verdict.finding === storedGuardrailFinding(arm.label.trim() || armLabel(arm.key), metric?.name ?? C.guardrail))
    return guardrailRecommendation(label(ctx, ctx.snapshot.verdict.worstArm ?? group?.key), metric?.name ?? C.guardrail)
  },
  collecting: ctx => {
    if (ctx.status === 'stopped') return C.stoppedCollecting
    const needed = ctx.snapshot.power.exposuresNeededPerArm
    const groups = ctx.phase?.arms.filter(arm => arm.kind !== 'holdout').length ?? ctx.snapshot.k + 1
    return needed === null ? C.collecting : collectingRecommendation(formatCount(Math.round(needed * groups)))
  },
  'original-better': () => C.originalBetter,
  'worse-none-better': ctx => worseRecommendation(label(ctx, worse(ctx))),
  winner: ctx => winnerRecommendation(label(ctx, ctx.snapshot.verdict.recommendedArm)),
  mixed: ctx => mixedRecommendation(label(ctx, ctx.snapshot.verdict.recommendedArm), label(ctx, worse(ctx))),
  'keep-running': ctx => {
    // Same condition as the server's long-duration branch (src/results/verdict.ts).
    const power = ctx.snapshot.power
    if (!power.feasible || (power.daysRemaining !== null && power.daysRemaining > 90)) return C.longDuration
    const days = ctx.plannedDurationDays
    const start = Date.parse(ctx.phase?.startedAt ?? '')
    const end = days != null && Number.isFinite(days) && days > 0 ? start + days * 86_400_000 : NaN
    return Number.isFinite(end) ? runningRecommendation(formatDate(end)) : C.keepRunning
  },
  'no-difference': () => C.noDifference,
  'rollout-collecting': ctx => rolloutCollectingRecommendation(rolloutWinner(ctx).label),
  'rollout-readout': ctx => rolloutReadoutRecommendation(rolloutWinner(ctx).label, formatPercent(
    primary(ctx)?.comparisons.find(comparison => comparison.arm === rolloutWinner(ctx).key)?.lift, true)),
}
export const recommendation = (ctx: RecommendationContext): string => {
  if (!isLegacySnapshot(ctx.snapshot) && ctx.snapshot.phaseKind === 'rollout' && ctx.snapshot.winnerArm === null) return RESULTS_COPY.missingWinner
  const sentence = RECOMMENDATION[ctx.snapshot.verdict.code]
  return sentence(ctx)
}

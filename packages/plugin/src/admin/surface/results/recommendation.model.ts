import type { PhaseSummary } from '../../../types/endpoints.js'
import type { Snapshot, VerdictCode } from '../../../types/snapshot.js'
import { armLabel } from '../../labels.js'
import { formatCount, formatPercent } from '../../results/format.js'
import {
  RECOMMENDATION_COPY as C, collectingRecommendation, guardrailRecommendation, mixedRecommendation,
  rolloutCollectingRecommendation, rolloutReadoutRecommendation, runningRecommendation, winnerRecommendation, worseRecommendation, storedGuardrailFinding,
} from '../../copy/recommendation.js'

export interface RecommendationContext {
  snapshot: Snapshot
  phase?: PhaseSummary
  plannedDurationDays?: number | null
}
function label(ctx: RecommendationContext, key: string | null | undefined, fallback = C.group as string): string {
  const stored = ctx.phase?.arms.find(arm => arm.key === key)?.label.trim()
  return stored || (key && ['control', 'variantA', 'variantB', 'variantC', 'holdout'].includes(key) ? armLabel(key) : fallback)
}
const primary = ({ snapshot }: RecommendationContext) => snapshot.metrics.find(metric => metric.role === 'primary')
const worse = (ctx: RecommendationContext) => primary(ctx)?.comparisons.find(comparison => comparison.significant === 'worse')?.arm
const winner = (ctx: RecommendationContext) => label(ctx, ctx.snapshot.winnerArm ?? ctx.snapshot.verdict.recommendedArm, C.winner)

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
    return guardrailRecommendation(label(ctx, group?.key), metric?.name ?? C.guardrail)
  },
  collecting: ctx => {
    const needed = ctx.snapshot.power.exposuresNeededPerArm
    const groups = ctx.phase?.arms.filter(arm => arm.kind !== 'holdout').length ?? ctx.snapshot.k + 1
    return needed === null ? C.collecting : collectingRecommendation(formatCount(Math.round(needed * groups)))
  },
  'original-better': () => C.originalBetter,
  'worse-none-better': ctx => worseRecommendation(label(ctx, worse(ctx))),
  winner: ctx => winnerRecommendation(label(ctx, ctx.snapshot.verdict.recommendedArm)),
  mixed: ctx => mixedRecommendation(label(ctx, ctx.snapshot.verdict.recommendedArm), label(ctx, worse(ctx))),
  'keep-running': ctx => {
    const days = ctx.plannedDurationDays
    const start = Date.parse(ctx.phase?.startedAt ?? '')
    const end = days != null && Number.isFinite(days) && days > 0 ? start + days * 86_400_000 : NaN
    return Number.isFinite(end) ? runningRecommendation(new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(end)) : C.keepRunning
  },
  'no-difference': () => C.noDifference,
  'rollout-collecting': ctx => rolloutCollectingRecommendation(winner(ctx)),
  'rollout-readout': ctx => rolloutReadoutRecommendation(winner(ctx), formatPercent(
    primary(ctx)?.comparisons.find(comparison => comparison.arm === (ctx.snapshot.winnerArm ?? ctx.snapshot.verdict.recommendedArm))?.lift, true)),
}
export const recommendation = (ctx: RecommendationContext): string => RECOMMENDATION[ctx.snapshot.verdict.code](ctx)

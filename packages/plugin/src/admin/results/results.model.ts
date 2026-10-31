import type { DocId, Status } from '../../types/contracts.js'
import type { PhaseSummary, ResultsResponse } from '../../types/endpoints.js'
import type { Snapshot } from '../../types/snapshot.js'
import { armLabel, phaseKindLabel, verdictCodeLabel } from '../labels.js'
import {
  RESULTS_COPY, cappedCount, collectingCopy, conflictCopy, decidedTitle, exclusionCopy,
  ignoredCopy, metricUnavailable, moreDays, roundLabel, shareCopy, shippingTitle, srmP, uncappedTotal,
} from '../copy/results.js'
import { formatCI, formatCount, formatMetric, formatPercent, formatProbability } from './format.js'

type Metric = Snapshot['metrics'][number]
type Arm = Metric['perArm'][number]
type Decision = { phase: number; winnerArm?: string }
// The frozen wire type currently omits these two fields. Accept additive server
// fields without casting or deriving either value from a verdict's prose.
type DisplaySnapshot = Snapshot & { winnerArm?: string; minExposuresPerArm?: number }

export function defaultRound({ phases, decision, status }: Pick<ResultsResponse, 'phases'> & {
  decision?: Decision | null; status: Status
}): number | null {
  if (status === 'decided' && decision) return decision.phase
  return phases.reduce<number | null>((latest, phase) => latest === null || phase.phase > latest ? phase.phase : latest, null)
}

export function roundOptions(phases: PhaseSummary[]) {
  return phases.map(phase => ({ value: phase.phase, label: roundLabel(phase.phase, phaseKindLabel(phase.phaseKind)) }))
}

export type VerdictCardModel =
  | { title: string; finding: string | null; detail: string | null }
  | { headline: string; detail: string; guardrailLine?: string }

export function verdictCard({ snapshot, decisionSnapshot, isDecidedTestRound, winnerLabel }: {
  snapshot: Snapshot; decisionSnapshot?: Snapshot; isDecidedTestRound: boolean; winnerLabel: string
}): VerdictCardModel {
  if (isDecidedTestRound) return {
    title: decidedTitle(winnerLabel), finding: decisionSnapshot?.verdict.finding ?? null,
    detail: decisionSnapshot?.verdict.detail ?? null,
  }
  const { headline, detail, guardrailLine } = snapshot.verdict
  return { headline, detail, ...(guardrailLine === undefined ? {} : { guardrailLine }) }
}

export function rolloutLine(snapshot: DisplaySnapshot, phase: PhaseSummary, decision?: Pick<Decision, 'winnerArm'>): string | null {
  if (snapshot.phaseKind !== 'rollout') return null
  const winner = snapshot.winnerArm ?? decision?.winnerArm
  if (!winner) return null
  return shippingTitle(phase.arms.find(arm => arm.key === winner)?.label ?? armLabel(winner))
}

export interface CappedCellModel { statistic: string; totalLine?: string; cappedLine?: string; notice?: string }
export function cappedCell({ metric, arm, caps }: {
  metric: Pick<Metric, 'metricId' | 'kind'> & { capNotice?: 'no-history' }
  arm?: Arm; caps?: Snapshot['params']['caps']
}): CappedCellModel {
  const cap = caps?.[metric.metricId]
  const model: CappedCellModel = { statistic: formatMetric(arm?.mean, metric.kind) }
  if (metric.kind !== 'revenue') return model
  if (cap?.resolvedCap === null || (!cap && metric.capNotice === 'no-history')) model.notice = RESULTS_COPY.noCap
  if (arm?.capped) {
    model.totalLine = uncappedTotal(formatMetric(arm.capped.uncappedTotal, metric.kind))
    model.cappedLine = cappedCount(formatCount(arm.capped.cappedCount), formatMetric(cap?.resolvedCap, metric.kind))
  }
  return model
}

export type ComparisonModel = {
  method: 'sequential'; lift: string; ci: string; adjustedCI?: string; pValue: string
  significance: string
} | { method: 'bayesian'; chanceToWin: string; ci: string; risk: string; significance: string }
export interface ArmRow {
  key: string; label: string; n: string; value: string; capped: CappedCellModel
  baseline?: string; comparison?: ComparisonModel
}
export function armRows({ snapshot, phase, metricId }: { snapshot: Snapshot; phase: PhaseSummary; metricId: DocId }): ArmRow[] {
  const metric = snapshot.metrics.find(metric => metric.metricId === metricId)
  return phase.arms.map(group => {
    const arm = metric?.perArm.find(arm => arm.arm === group.key)
    const cell = cappedCell({ metric: metric ?? phase.metrics.find(metric => metric.metricId === metricId) ?? { metricId, kind: 'count' }, arm, caps: snapshot.params.caps })
    const row: ArmRow = {
      key: group.key, label: group.label, n: formatCount(arm?.n ?? snapshot.exposures.perArm[group.key]),
      value: metric?.kind === 'binomial' ? formatCount(arm?.converters) : cell.statistic, capped: cell,
    }
    if (group.kind === 'holdout') return { ...row, baseline: RESULTS_COPY.holdout }
    if (group.kind === 'control') return { ...row, baseline: RESULTS_COPY.original }
    const comparison = metric?.comparisons.find(comparison => comparison.arm === group.key)
    if (!comparison) return row
    const common = { ci: formatCI(comparison.ci), significance: RESULTS_COPY.significance[comparison.significant] }
    row.comparison = snapshot.method === 'bayesian'
      ? { ...common, method: 'bayesian', chanceToWin: formatPercent(comparison.chanceToWin), risk: formatPercent(comparison.risk) }
      : {
        ...common, method: 'sequential', lift: formatPercent(comparison.lift, true),
        ...(snapshot.alphaAdjusted !== snapshot.alpha ? { adjustedCI: formatCI(comparison.ciAdjusted) } : {}),
        pValue: formatProbability(comparison.pValueAdjusted ?? comparison.pValue),
      }
    return row
  })
}

export function guardrailChips(snapshot: Snapshot) {
  return snapshot.guardrails.map(guardrail => ({
    name: snapshot.metrics.find(metric => metric.metricId === guardrail.metricId)?.name ?? '—',
    status: RESULTS_COPY.guardrails[guardrail.status],
  }))
}

export function powerLine(power: Snapshot['power']): string {
  if (!power.feasible) return RESULTS_COPY.infeasible
  return power.daysRemaining !== null && power.daysRemaining > 0
    ? moreDays(formatProbability(power.daysRemaining)) : RESULTS_COPY.plannedEnd
}

export interface ResultsContext {
  phase?: PhaseSummary; minExposuresPerArm?: number
  inLayer?: boolean; layerSlices?: number | readonly number[]; allocation?: number
}
function comparedKeys(snapshot: Snapshot, phase?: PhaseSummary): string[] {
  return phase ? phase.arms.filter(arm => arm.kind !== 'holdout' || snapshot.phaseKind === 'rollout').map(arm => arm.key)
    : Object.keys(snapshot.exposures.perArm).filter(key => key !== 'holdout' || snapshot.phaseKind === 'rollout')
}
function smallest(values: Array<number | undefined>): number | undefined {
  if (!values.length || values.some(value => value === undefined || !Number.isFinite(value))) return undefined
  return values.reduce<number | undefined>((min, value) => min === undefined || (value !== undefined && value < min) ? value : min, undefined)
}

/** Only selects stored counts; never estimates sample sizes or power in the UI. */
export function collectingLine(snapshot: DisplaySnapshot, ctx: ResultsContext = {}): string | null {
  if (snapshot.verdict.row !== 4) return null
  const keys = comparedKeys(snapshot, ctx.phase)
  const primary = snapshot.metrics.find(metric => metric.role === 'primary')
  return collectingCopy(
    formatCount(smallest(keys.map(key => snapshot.exposures.perArm[key]))),
    formatCount(snapshot.minExposuresPerArm ?? ctx.minExposuresPerArm),
    formatCount(smallest(keys.map(key => primary?.perArm.find(arm => arm.arm === key)?.converters))),
    formatCount(primary ? snapshot.params.minSampleSizes[primary.metricId] : undefined),
  )
}

export interface DataQualityItem { id: string; message: string; detail?: string; nextStep: string; shares?: string[] }
export function dataQuality(snapshot: DisplaySnapshot, ctx: ResultsContext = {}): DataQualityItem[] {
  const items: DataQualityItem[] = []
  if (snapshot.srm.flagged) items.push({
    id: 'srm', message: srmP(formatProbability(snapshot.srm.p)), nextStep: RESULTS_COPY.srm,
    shares: Object.entries(snapshot.srm.expected).map(([key, expected]) => shareCopy(
      ctx.phase?.arms.find(arm => arm.key === key)?.label ?? armLabel(key), formatPercent(expected),
      formatPercent(snapshot.exposures.total > 0 ? (snapshot.exposures.perArm[key] ?? 0) / snapshot.exposures.total : undefined),
    )),
  })
  const exposures = snapshot.exposures
  if (exposures.excludedMultiArm > 0 || exposures.multiArmShare > 0) items.push({
    id: 'multi-group', message: RESULTS_COPY.multiGroup,
    detail: exclusionCopy(formatCount(exposures.excludedMultiArm), formatPercent(exposures.multiArmShare)), nextStep: RESULTS_COPY.multiGroupNext,
  })
  if (exposures.armMismatch > 0) items.push({
    id: 'mismatch', message: RESULTS_COPY.mismatch, detail: ignoredCopy(formatCount(exposures.armMismatch)), nextStep: RESULTS_COPY.mismatchNext,
  })
  if (exposures.identityConflictShare > 0) items.push({
    id: 'identity', message: RESULTS_COPY.identity, detail: conflictCopy(formatPercent(exposures.identityConflictShare)), nextStep: RESULTS_COPY.identityNext,
  })
  const minExposures = snapshot.minExposuresPerArm ?? ctx.minExposuresPerArm
  if (minExposures !== undefined && comparedKeys(snapshot, ctx.phase).some(key => (exposures.perArm[key] ?? 0) < minExposures)) items.push({
    id: 'too-few', message: RESULTS_COPY.tooFew, nextStep: RESULTS_COPY.tooFewNext,
  })
  const slices = typeof ctx.layerSlices === 'number' ? ctx.layerSlices : ctx.layerSlices?.length
  if (ctx.inLayer && slices !== undefined && ctx.allocation !== undefined && slices < ctx.allocation) items.push({
    id: 'layer', message: RESULTS_COPY.layerFull, nextStep: RESULTS_COPY.layerNext,
  })
  for (const metric of snapshot.metrics) if (metric.unavailable !== undefined) items.push({
    id: `metric-${metric.metricId}`, message: metricUnavailable(metric.name, metric.unavailable), nextStep: RESULTS_COPY.unavailableNext,
  })
  return items
}

export function verdictLabel(snapshot: Snapshot): string { return verdictCodeLabel(snapshot.verdict.code) }

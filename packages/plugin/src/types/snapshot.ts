export type SnapshotHealth = { code: 'version-page-unavailable' | 'version-page-unchecked'; path: string } | { code: 'goal-in-some-versions'; metricId: string | number; name: string }
import type { GaussianPrior } from '@delmaredigital/experiments-stats'
import type { DocId, MetricSource } from './contracts.js'
import type { MetricUnavailableReason } from './reasons.js'
export type VerdictCode = 'unavailable' | 'data-problem' | 'guardrail-failing' | 'collecting' | 'original-better' | 'worse-none-better' | 'winner' | 'mixed' | 'keep-running' | 'no-difference' | 'rollout-collecting' | 'rollout-readout'
export interface Snapshot {
  experiment: DocId; phase: number; phaseKind: 'test' | 'rollout'; computedAt: string
  winnerArm: string | null; minExposuresPerArm: number
  window: { from: string; to: string }; method: 'sequential' | 'bayesian'; alpha: number; alphaAdjusted: number; k: number
  params: {
    sequentialTuningParameter: number; prior: GaussianPrior; cupedLookbackDays: number
    caps: Record<DocId, { type: 'percentile' | 'absolute'; value: number; resolvedCap: number | null; historyUnits?: number }>
    attributionWindows: Record<DocId, number>; guardrailThresholds: Record<DocId, number>; minSampleSizes: Record<DocId, number>; bayesian: { ctw: number; risk: number }
  }
  exposures: { total: number; perArm: Record<string, number>; excludedMultiArm: number; multiArmShare: number; armMismatch: number; identityConflictShare: number; capped: Record<DocId, number> }
  srm: { p: number; flagged: boolean; expected: Record<string, number> }
  metrics: Array<{
    metricId: DocId; name: string; kind: MetricSource['kind']; role: 'primary' | 'secondary' | 'guardrail'; cupedApplied: boolean; unavailable?: MetricUnavailableReason | string
    perArm: Array<{ arm: string; n: number; converters: number; sum: number; sumSquares: number; mean: number; variance: number; covariate?: { preSum: number; preSumSquares: number; postPreSumOfProducts: number }; capped?: { resolvedCap: number; uncappedTotal: number; cappedCount: number } }>
    // Null CI bounds are unbounded or unavailable; JSON snapshots never store ±Infinity.
    comparisons: Array<{ arm: string; lift: number; ci: [number | null, number | null]; ciAdjusted: [number | null, number | null]; pValue?: number; pValueAdjusted?: number; chanceToWin?: number; risk?: number; significant: 'better' | 'worse' | 'none' }>
  }>
  guardrails: Array<{ metricId: DocId; status: 'failing' | 'ok' | 'warning' | 'insufficient' }>
  power: { daysRemaining: number | null; exposuresNeededPerArm: number | null; lowerBound: boolean; feasible: boolean }
  verdict: { row: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 'R1' | 'R2' | 'R3'; code: VerdictCode; finding: string; action: string | null; headline: string; detail: string; recommendedArm: string | null; guardrailLine?: string; worstArm?: string }
  goalFairnessNotice?: string
  health?: SnapshotHealth[]
  contentChanges: Array<{ at: string; doc: { collection: string; id: DocId }; by: DocId | null }>
}

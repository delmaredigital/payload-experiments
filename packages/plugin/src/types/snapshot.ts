import type { MetricSource } from './contracts.js'
export type VerdictCode = 'unavailable' | 'data-problem' | 'guardrail-failing' | 'collecting' | 'original-better' | 'worse-none-better' | 'winner' | 'mixed' | 'keep-running' | 'no-difference' | 'rollout-collecting' | 'rollout-readout'
export interface Snapshot {
  experiment: string; phase: number; phaseKind: 'test' | 'rollout'; computedAt: string
  window: { from: string; to: string }; method: 'sequential' | 'bayesian'; alpha: number; alphaAdjusted: number; k: number
  params: {
    sequentialTuningParameter: number; prior: { mean: number; variance: number; proper: boolean }; cupedLookbackDays: number
    caps: Record<string, { type: 'percentile' | 'absolute'; value: number; resolvedCap: number | null; historyUnits?: number }>
    attributionWindows: Record<string, number>; guardrailThresholds: Record<string, number>; minSampleSizes: Record<string, number>; bayesian: { ctw: number; risk: number }
  }
  exposures: { total: number; perArm: Record<string, number>; excludedMultiArm: number; multiArmShare: number; armMismatch: number; identityConflictShare: number; capped: Record<string, number> }
  srm: { p: number; flagged: boolean; expected: Record<string, number> }
  metrics: Array<{
    metricId: string; name: string; kind: MetricSource['kind']; role: 'primary' | 'secondary' | 'guardrail'; cupedApplied: boolean; unavailable?: string
    perArm: Array<{ arm: string; n: number; converters: number; sum: number; sumSquares: number; mean: number; variance: number; covariate?: { mean: number; variance: number; covariance: number }; capped?: { resolvedCap: number; uncappedTotal: number; cappedCount: number } }>
    comparisons: Array<{ arm: string; lift: number; ci: [number, number]; ciAdjusted: [number, number]; pValue?: number; pValueAdjusted?: number; chanceToWin?: number; risk?: number; significant: 'better' | 'worse' | 'none' }>
  }>
  guardrails: Array<{ metricId: string; status: 'failing' | 'ok' | 'warning' | 'insufficient' }>
  power: { daysRemaining: number; exposuresNeededPerArm: number; lowerBound: boolean; feasible: boolean }
  verdict: { row: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 'R1' | 'R2' | 'R3'; code: VerdictCode; finding: string; action: string | null; headline: string; detail: string; recommendedArm: string | null; guardrailLine?: string }
  contentChanges: Array<{ at: string; doc: string; by: string }>
}

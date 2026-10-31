import type { ArmKind, ExposurePolicy, MetricSource } from './contracts.js'
import type { Snapshot, VerdictCode } from './snapshot.js'
export type RefusalCode = 'weights-total' | 'control-count' | 'control-first' | 'holdout-last' | 'holdout-count' | 'variant-count' | 'duplicate-key' | 'duplicate-slot' | 'slot-required' | 'no-planned-duration' | 'no-primary-metric' | 'no-placements' | 'empty-slot' | 'page-no-targets' | 'page-user-unit' | 'flag-no-point' | 'flag-params-invalid' | 'flag-point-busy' | 'flag-placement-missing' | 'layer-full' | 'layer-unit-mismatch' | 'unit-source-mismatch' | 'no-reach-per-day' | 'invalid-status' | 'stale-draft' | 'commit-unverified' | 'allocation-lower' | 'confirmation-required' | 'invalid-winner' | 'slices-taken' | 'locked-placement' | 'not-implemented' | 'forbidden' | 'unauthenticated' | 'body-too-large' | 'invalid-body'
export type ErrorEnvelope = { errors: Array<{ code: RefusalCode; message: string; detail?: unknown }> }
export type TransitionSuccess = { doc: Record<string, unknown>; revision: number }
export type AllocateBody = { allocation: number }
export type AddMetricBody = { metric: string; role: 'secondary' | 'guardrail' }
export type DecideBody = { winnerArm: string; note?: string; confirmation?: string }
export type ArchiveBody = { mode: 'stopped' | 'after-content' | 'discard' | 'hard-coded'; confirmation?: string }
export type MakeContentResult = TransitionSuccess & { docs: Array<{ collection: string; id: string; ok: boolean; error?: string }> }
export type PreflightResult = {
  checks: Array<{ code: RefusalCode; ok: boolean; detail?: unknown }>
  placements: Array<{ collection: string; id: string; title: string; url?: string; ok: boolean; detail?: string }>
  baseline: { metricId: string; value: number; days: 28 } | null
  trafficPerDay: number | null
  estimate: { weeks: number; plannedDurationDays: number; sequentialTuningParameter: number; feasible: boolean } | null
}
export type PreviewTokenResult = { token: string }
export interface PhaseSummary {
  phase: number; phaseKind: 'test' | 'rollout'; startedAt: string; endedAt: string | null
  arms: Array<{ key: string; label: string; kind: ArmKind }>
  metrics: Array<{ metricId: string; name: string; kind: MetricSource['kind']; role: 'primary' | 'secondary' | 'guardrail'; resolvedCap?: number | null; historyUnits?: number; capNotice?: 'no-history' }>
}
export type ResultsResponse = { phases: PhaseSummary[]; snapshot: Snapshot | null; decisionSnapshot?: Snapshot; series?: Array<{ computedAt: string; metricId: string; arm: string; lift: number; ci: [number, number] }> }
export type SummaryResponse = Record<string, { exposures: number; days: number; verdict: { code: VerdictCode; headline: string } | null }>
export type EventBody = { events: Array<{ type: 'exposure'; experiment: string; phase: number; arm: string; policy: ExposurePolicy } | { type: 'conversion'; eventName: string; idempotencyKey: string; attributes?: Record<string, string | number | boolean> }> }
export type AccessKind = 'manage' | 'readResults' | 'manifestKey' | 'signedCookie'

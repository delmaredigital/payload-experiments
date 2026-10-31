import type { ArmKind, DocId, ExposurePolicy, MetricSource, ResolvedOptions } from './contracts.js'
import type { Snapshot, VerdictCode } from './snapshot.js'
export type ArmIssueCode = 'weights-total' | 'control-count' | 'control-first' | 'holdout-last' | 'holdout-count' | 'variant-count' | 'duplicate-key' | 'duplicate-slot' | 'slot-required' | 'invalid-key'
export type RefusalCode = ArmIssueCode | 'not-found' | 'no-planned-duration' | 'no-primary-metric' | 'no-placements' | 'empty-slot' | 'page-no-targets' | 'page-user-unit' | 'flag-no-point' | 'flag-params-invalid' | 'flag-point-busy' | 'flag-placement-missing' | 'layer-full' | 'layer-unit-mismatch' | 'unit-source-mismatch' | 'no-reach-per-day' | 'invalid-status' | 'stale-draft' | 'commit-unverified' | 'allocation-lower' | 'confirmation-required' | 'invalid-winner' | 'slices-taken' | 'locked-placement' | 'not-implemented' | 'forbidden' | 'unauthenticated' | 'body-too-large' | 'invalid-body' | 'too-many-ids' | 'invalid-phase' | 'invalid-ids'
export type ErrorEnvelope = { errors: Array<{ code: RefusalCode; message: string; detail?: unknown }> }
export type TransitionSuccess = { doc: Record<string, unknown>; revision: number }
export type AllocateBody = { allocation: number }
export type AddMetricBody = { metric: DocId; role: 'secondary' | 'guardrail' }
export type DecideBody = { winnerArm: string; note?: string; confirmation?: string }
export type ArchiveBody = { mode: 'stopped' | 'after-content' | 'discard' | 'hard-coded'; confirmation?: string }
export type MakeContentResult = TransitionSuccess & { docs: Array<{ collection: string; id: DocId; ok: boolean; error?: string }> }
export type PreflightResult = {
  checks: Array<{ code: RefusalCode; ok: boolean; detail?: unknown }>
  placements: Array<{ collection: string; id: DocId; title: string; url?: string; ok: boolean; detail?: string }>
  baseline: { metricId: DocId; value: number; days: 28 } | null
  trafficPerDay: number | null
  estimate: { weeks: number; plannedDurationDays: number; sequentialTuningParameter: number; feasible: boolean } | null
}
export type PreviewTokenResult = { token: string }
export interface PhaseSummary {
  phase: number; phaseKind: 'test' | 'rollout'; startedAt: string; endedAt: string | null
  arms: Array<{ key: string; label: string; kind: ArmKind }>
  metrics: Array<{ metricId: DocId; name: string; kind: MetricSource['kind']; role: 'primary' | 'secondary' | 'guardrail'; resolvedCap?: number | null; historyUnits?: number; capNotice?: 'no-history' }>
}
export type ResultsResponse = { phases: PhaseSummary[]; snapshot: Snapshot | null; decisionSnapshot?: Snapshot; series?: Array<{ computedAt: string; metricId: DocId; arm: string; lift: number; ci: [number | null, number | null] }> }
export type SummaryResponse = Record<DocId, { exposures: number; days: number; verdict: { code: VerdictCode; headline: string } | null }>
// Client conversion value is accepted on the wire; the server stores 1 for client conversions.
export type EventBody = { events: Array<{ type: 'exposure'; experiment: string; phase: number; arm: string; policy: ExposurePolicy } | { type: 'conversion'; eventName: string; value?: number; idempotencyKey: string; attributes?: Record<string, string | number | boolean> }> }
export type AccessKind = 'manage' | 'readResults' | 'manifestKey' | 'signedCookie'

export type EndpointContext<TUser extends { id: string | number } = { id: string | number }> = { options: ResolvedOptions<TUser>; unit?: { visitorId: string } }

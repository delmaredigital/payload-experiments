import type { ArmKind, DocId, ExperimentKind, ExposurePolicy, MetricSource, ResolvedOptions, Status } from './contracts.js'
import type { ContentReportReason } from './reasons.js'
import type { ArmSlot } from './puck.js'
import type { ReadinessCode } from '../transitions/checkStart.js'
export type { ReadinessCode } from '../transitions/checkStart.js'
import type { Snapshot, VerdictCode } from './snapshot.js'
export type ArmIssueCode = 'weights-total' | 'control-count' | 'control-first' | 'holdout-last' | 'holdout-count' | 'variant-count' | 'duplicate-key' | 'duplicate-slot' | 'slot-required' | 'invalid-key'
/** Content-report dismiss/restore refusals (CORE-44). */
export type ContentEntryRefusal = 'not-decided' | 'entry-not-found' | 'entry-ok' | 'entry-dismissed' | 'entry-not-dismissed'
export type RefusalCode = ArmIssueCode | 'not-found' | ContentEntryRefusal | 'no-planned-duration' | 'no-primary-metric' | 'no-placements' | 'empty-slot' | 'page-no-targets' | 'page-target-unpublished' | 'page-user-unit' | 'version-page-unavailable' | 'version-page-unchecked' | 'flag-no-point' | 'flag-params-invalid' | 'flag-point-busy' | 'flag-placement-missing' | 'layer-full' | 'layer-unit-mismatch' | 'unknown-metric-source' | 'unit-source-mismatch' | 'no-reach-per-day' | 'invalid-status' | 'stale-draft' | 'stale-edit' | 'commit-unverified' | 'allocation-lower' | 'confirmation-required' | 'invalid-winner' | 'slices-taken' | 'locked-placement' | 'not-implemented' | 'forbidden' | 'unauthenticated' | 'body-too-large' | 'invalid-body' | 'too-many-ids' | 'invalid-phase' | 'invalid-ids' | 'recompute-failed' | 'analysis-failed' | 'undeclared-targeting-key' | 'invalid-targeting-rule' | 'block-path-rule' | 'duplicate-metric'
export type ErrorEnvelope = { errors: Array<{ code: RefusalCode; message: string; detail?: unknown }> }
export type TransitionSuccess = { doc: Record<string, unknown>; revision: number }
export type AllocateBody = { allocation: number }
export type AddMetricBody = { metric: DocId; role: 'secondary' | 'guardrail' }
export type DecideBody = { winnerArm: string; note?: string; confirmation?: string }
export type ArchiveBody = { mode: 'stopped' | 'after-content' | 'discard' | 'hard-coded'; confirmation?: string }
export type DismissContentEntryBody = { collection: string; id: DocId }
export type DismissContentEntryResult = Pick<TransitionSuccess, 'doc'>
export type RestoreContentEntryBody = DismissContentEntryBody
export type RestoreContentEntryResult = Pick<TransitionSuccess, 'doc'>
export type ContentReport = { docs: MakeContentResult['docs'] } | MakeContentResult['docs']
export type MakeContentResult = TransitionSuccess & { docs: Array<{ collection: string; id: DocId; ok: boolean; detail?: ContentReportReason | string; error?: ContentReportReason | string; dismissedAt?: string; dismissedBy?: string | null }> }
export type PreflightResult = {
  checks: Array<{ code: ReadinessCode; ok: boolean; detail?: unknown; warning?: boolean }>
  placements: Array<{ collection: string; id: DocId; title: string; url?: string; editorUrl?: string; slots?: Record<ArmSlot, number>; ok: boolean; detail?: string }>
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
export type ResultsResponse = {
  /** Filled by the results endpoint from CORE-48: what a results reader may see about the test. */
  experiment?: { name: string; kind: ExperimentKind; status: Status }
  phases: PhaseSummary[]; snapshot: Snapshot | null; decisionSnapshot?: Snapshot; decision?: { phase: number; winnerArm: string }; series?: Array<{ computedAt: string; metricId: DocId; arm: string; lift: number; ci: [number | null, number | null] }> }
export type SummaryResponse = Record<DocId, { ready?: boolean; next?: { code: ReadinessCode; detail?: unknown }; health?: Array<{ code: 'version-page-unavailable' | 'version-page-unchecked'; path: string }>; exposures: number; days: number; verdict: { code: VerdictCode; headline: string } | null }>
// Client conversion value is accepted on the wire; the server stores 1 for client conversions.
export type EventBody = { events: Array<{ type: 'exposure'; experiment: string; phase: number; arm: string; policy: ExposurePolicy } | { type: 'conversion'; eventName: string; value?: number; idempotencyKey: string; attributes?: Record<string, string | number | boolean> }> }
export type AccessKind = 'manage' | 'readResults' | 'manifestKey' | 'signedCookie'

export type EndpointContext<TUser extends { id: string | number } = { id: string | number }> = { options: ResolvedOptions<TUser>; unit?: { visitorId: string } }

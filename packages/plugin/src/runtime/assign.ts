import { assignArm, hash, inRange, rolloutBucketRanges } from '@delmaredigital/experiments-stats'
import type { Assignments } from '../types/assignments.js'
import type { Attributes } from '../types/contracts.js'
import type { Manifest } from '../types/manifest.js'
import { eligibility, type AssignmentUnit } from './eligibility.js'
import type { AttributeKeys } from './targeting.js'

/** Deferred slugs travel on the wire and are evaluated after server session resolution. */
export interface AssignmentResult extends Assignments { deferred: string[] }
export interface AssignOptions {
  now: number
  staff?: boolean; bot?: boolean; preview?: boolean; sessionUnknown?: boolean; method?: string
  attributeKeys?: AttributeKeys
  onInvalid?(slug: string, reason: string): void
}

/** Also used after header decoding so flag results always reflect the rendered content. */
export function fillFlagPoints(result: Assignments, manifest: Manifest): void {
  for (const [id, value] of Object.entries(manifest.flagDefaults)) {
    result.flagPoints[id] = { arm: value.winnerArm, params: { ...value.params }, source: 'default', exposable: false }
  }
  for (const experiment of manifest.experiments) {
    const assignment = result.bySlug[experiment.slug]
    if (!experiment.flagPoint || !assignment) continue
    const contentArm = experiment.arms.find(arm => arm.key === assignment.arm && arm.kind !== 'holdout')
      ?? experiment.arms.find(arm => arm.kind === 'control')
    result.flagPoints[experiment.flagPoint] = {
      arm: assignment.arm, params: { ...contentArm?.params }, source: 'experiment',
      experiment: experiment.slug, experimentId: experiment.id, phase: experiment.phase,
      policy: assignment.policy, exposable: assignment.exposable,
    }
  }
}

/** Pure shared assignment path; time is supplied by the request's caller. */
export function assign(manifest: Manifest, unit: AssignmentUnit, attributes: Attributes, opts: AssignOptions): AssignmentResult {
  const result: AssignmentResult = {
    revision: manifest.revision, visitorId: unit.visitorId, userId: unit.userId,
    bySlug: Object.create(null), flagPoints: Object.create(null), archivedWinners: { ...manifest.archivedWinners }, deferred: [],
    staff: opts.staff ?? attributes.staff === true, bot: opts.bot ?? false, preview: opts.preview ?? false,
    sessionUnknown: opts.sessionUnknown ?? unit.sessionUnknown ?? false, method: opts.method ?? 'GET',
  }
  for (const experiment of manifest.experiments) {
    if (experiment.status !== 'running' && experiment.status !== 'decided') continue
    if ((experiment.status === 'decided' || experiment.phaseKind === 'rollout') && !experiment.arms.some(arm => arm.key === experiment.winnerArm)) {
      opts.onInvalid?.(experiment.slug, 'invalid-winner-arm')
      continue
    }
    if (experiment.phaseKind === 'rollout' && !experiment.arms.some(arm => arm.key === experiment.holdoutKey)) {
      opts.onInvalid?.(experiment.slug, 'invalid-holdout-key')
      continue
    }
    const eligible = eligibility(experiment, unit, attributes, { ...opts, sessionUnknown: result.sessionUnknown })
    if (eligible.kind === 'deferred') {
      result.deferred.push(experiment.slug)
      continue
    }
    const control = experiment.arms.find(arm => arm.kind === 'control')!
    let arm = control.key, exposable = false
    if (eligible.kind === 'eligible') {
      if (experiment.status === 'decided' && !experiment.holdoutKey) {
        arm = experiment.winnerArm as typeof arm
      } else if (experiment.phaseKind === 'rollout') {
        if (!experiment.seed.endsWith('|')) throw new RangeError('Assignment seed must end in |')
        const ranges = rolloutBucketRanges(experiment.arms.map(arm => arm.weight), eligible.coverage)
        const bucket = hash(experiment.seed, eligible.unitId, 2)!
        const holdout = eligible.inLayer && inRange(bucket, ranges.holdout)
        arm = (holdout ? experiment.holdoutKey : experiment.winnerArm) as typeof arm
        exposable = eligible.inLayer && (holdout || inRange(bucket, ranges.winner))
      } else if (eligible.inLayer) {
        const index = assignArm({ seed: experiment.seed, unitId: eligible.unitId, weights: experiment.arms.map(arm => arm.weight), coverage: eligible.coverage })
        if (index !== -1) { arm = experiment.arms[index]!.key; exposable = true }
      }
    }
    result.bySlug[experiment.slug] = {
      slug: experiment.slug, experimentId: experiment.id, arm, phase: experiment.phase,
      exposable: exposable && !result.staff && !result.bot && !result.preview && result.method.toUpperCase() !== 'HEAD',
      policy: experiment.exposurePolicy, source: eligible.kind === 'ineligible' ? 'fallback' : 'recomputed',
    }
  }
  fillFlagPoints(result, manifest)
  return result
}

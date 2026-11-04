import { checkArms } from '../collections/experiments/armInvariants.js'
import { normalisePath } from '../runtime/normalisePath.js'
import { isOpValid } from '../targeting/ops.js'
import type { Arm, DocId, ExperimentKind, ExposurePolicy, FlagPoint, MetricSource, ResolvedOptions, Status, TargetingRule, UnitType } from '../types/contracts.js'
import type { ArmIssueCode, PreflightResult } from '../types/endpoints.js'
import type { BlockPlacement, FlagPlacement } from './placements.js'

export type ReadinessCode = ArmIssueCode
  | 'invalid-status'
  | 'no-planned-duration'
  | 'no-primary-metric'
  | 'no-reach-per-day'
  | 'version-identical'
  | 'version-same-address'
  | 'unknown-collection'
  | 'page-no-targets'
  | 'page-in-use'
  | 'page-target-unpublished'
  | 'page-targets-unchecked'
  | 'version-page-unavailable'
  | 'version-page-unchecked'
  | 'page-user-unit'
  | 'flag-no-point'
  | 'flag-params-invalid'
  | 'flag-point-busy'
  | 'flag-placement-missing'
  | 'no-placements'
  | 'empty-slot'
  | 'make-content-unsupported'
  | 'layer-unit-mismatch'
  | 'layer-full'
  | 'unknown-metric-source'
  | 'unit-source-mismatch'
  | 'block-path-rule'
  | 'undeclared-targeting-key'
  | 'invalid-targeting-rule'

export interface StartExperiment {
  id: DocId; slug: string; status: Status; kind: ExperimentKind; unitType: UnitType
  pageCollection?: string | null
  arms: Arm[]; allocation: number; exposurePolicy: ExposurePolicy; flagPoint?: string | null
  layer?: DocId | { id: DocId } | null; targeting?: TargetingRule[] | null
  metrics?: { primary?: DocId | { id: DocId } | null; secondary?: Array<DocId | { id: DocId }> | null; guardrails?: Array<DocId | { id: DocId }> | null } | null
  analysis?: { plannedDurationDays?: number | null; reachPerDay?: number | null; sequentialTuningParameter?: number | null; method?: string | null } | null
}
export interface StartMetric { id: DocId; source: string }
export type PlacementFailure = 'placements-failed' | 'forbidden' | 'not-found'
export interface CheckStartInput {
  experiment: StartExperiment; metrics: StartMetric[]; metricSources?: Pick<MetricSource, 'id' | 'keyedBy'>[]
  flagPoints?: FlagPoint[]; placements?: BlockPlacement[]; flagPlacements?: FlagPlacement[]
  placementError?: PlacementFailure; flagPlacementError?: PlacementFailure; flagPointBusy?: boolean
  unknownPageCollection?: boolean; identicalVersions?: Array<{ arm: string; path: string; collection: string; id: DocId }>
  unpublishedPageTargets?: string[]; pageTargetsUnchecked?: boolean
  pageTestsInUse?: Pick<StartExperiment, 'id' | 'arms'>[]
  layer?: { unitType: UnitType; usedSlices: number[] } | null
  attributeKeys?: ResolvedOptions['attributeKeys']
}
export const ARM_CHECK_ORDER: readonly ArmIssueCode[] = [
  'weights-total', 'control-count', 'control-first', 'holdout-count', 'holdout-last', 'variant-count',
  'invalid-key', 'duplicate-key', 'slot-required', 'duplicate-slot',
]
export const relationshipId = (value: DocId | { id: DocId } | null | undefined): DocId | undefined => value == null ? undefined : typeof value === 'object' ? value.id : value
/** Every path the runtime would match for these arms (pageRewrite, experimentMetadata): any string
 * pageTarget, holdout included, normalised the same way ('' is '/'). Occupancy and lock keys use this. */
export const pageTargetPaths = (arms: readonly Arm[]): string[] => [...new Set(arms
  .filter(arm => typeof arm.pageTarget === 'string')
  .map(arm => normalisePath(arm.pageTarget!)))].sort()
const positive = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0

function invalidParams(arms: Arm[], point: FlagPoint): unknown[] {
  return arms.flatMap(arm => {
    // Holdouts render the control's effective defaults and have no params of their own.
    if (arm.kind === 'holdout') return []
    const params = arm.params ?? {}
    return Object.entries(point.params).flatMap(([key, field]) => {
      const value = params[key]
      const missing = value == null || value === ''
      const invalid = missing ? field.required === true
        : field.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max
        : field.type === 'checkbox' ? typeof value !== 'boolean'
        : field.type === 'select' ? !field.options?.some(option => option.value === value)
        : typeof value !== 'string' || field.required === true && !value.trim()
      return invalid ? [{ arm: arm.key, field: key }] : []
    })
  })
}

/** Pure Review/Start predicates in refusal order. Inapplicable checks pass. */
export function checkStart(input: CheckStartInput): PreflightResult['checks'] {
  const { experiment: e } = input
  const checks: PreflightResult['checks'] = []
  const add = (code: ReadinessCode, ok: boolean, detail?: unknown) => checks.push({ code, ok, ...(!ok && detail !== undefined ? { detail } : {}) })
  add('invalid-status', e.status === 'draft' || e.status === 'stopped')
  const issues = checkArms(e.arms, e.kind)
  for (const code of ARM_CHECK_ORDER) {
    const matches = issues.filter(issue => issue.code === code)
    add(code, matches.length === 0, matches)
  }
  add('no-planned-duration', positive(e.analysis?.plannedDurationDays))
  const primary = relationshipId(e.metrics?.primary)
  add('no-primary-metric', primary !== undefined && input.metrics.some(metric => String(metric.id) === String(primary)))
  add('no-reach-per-day', !['manual', 'viewport'].includes(e.exposurePolicy) || positive(e.analysis?.reachPerDay))
  add('page-no-targets', e.kind !== 'page' || e.arms.filter(arm => arm.kind !== 'holdout').every(arm => typeof arm.pageTarget === 'string' && arm.pageTarget.trim().length > 0))
  add('unknown-collection', !input.unknownPageCollection)
  const addressed = new Map<string, string>()
  const duplicate = e.kind === 'page' ? e.arms.filter(arm => arm.kind !== 'holdout' && arm.pageTarget).flatMap(arm => {
    const path = normalisePath(arm.pageTarget!)
    const otherArm = addressed.get(path)
    addressed.set(path, arm.key)
    return otherArm ? [{ arm: arm.key, otherArm, path }] : []
  }) : []
  add('version-same-address', duplicate.length === 0, duplicate[0])
  for (const detail of input.identicalVersions ?? []) checks.push({ code: 'version-identical', ok: true, warning: true, detail })
  const occupiedPaths = new Set((input.pageTestsInUse ?? []).filter(other => String(other.id) !== String(e.id))
    .flatMap(other => pageTargetPaths(other.arms)))
  const sharedPaths = e.kind === 'page' ? pageTargetPaths(e.arms).filter(path => occupiedPaths.has(path)) : []
  add('page-in-use', sharedPaths.length === 0, { paths: sharedPaths })
  add('page-target-unpublished', !input.unpublishedPageTargets?.length, input.unpublishedPageTargets?.[0])
  add('page-targets-unchecked', true)
  if (input.pageTargetsUnchecked) checks[checks.length - 1]!.warning = true
  add('page-user-unit', e.kind !== 'page' || e.unitType === 'visitor')
  const point = input.flagPoints?.find(point => point.id === e.flagPoint)
  add('flag-no-point', e.kind !== 'flag' || !!point)
  const params = e.kind === 'flag' && point ? invalidParams(e.arms, point) : []
  add('flag-params-invalid', params.length === 0, params)
  add('flag-point-busy', e.kind !== 'flag' || !input.flagPointBusy)
  const missing = input.flagPlacements === undefined ? [] : e.arms.filter(arm => arm.kind !== 'holdout' && !input.flagPlacements!.some(placement => placement.arm === arm.key && placement.ok))
  const failed = input.flagPlacements?.filter(placement => !placement.ok) ?? []
  add('flag-placement-missing', e.kind !== 'flag' || !input.flagPlacementError && missing.length === 0 && failed.length === 0,
    input.flagPlacementError ?? { missing: missing.map(arm => arm.key), placements: failed })
  const placements = input.placements ?? []
  add('no-placements', e.kind !== 'block' || !input.placementError && placements.length > 0, input.placementError)
  const empty = placements.filter(placement => e.arms.some(arm => arm.kind !== 'holdout' && (!arm.slot || !(placement.slots[arm.slot] > 0))))
  add('empty-slot', e.kind !== 'block' || empty.length === 0, empty)
  add('make-content-unsupported', true)
  const localized = placements.find(placement => placement.localized)
  if (localized) Object.assign(checks[checks.length - 1]!, { warning: true, detail: localized.title })
  add('layer-unit-mismatch', e.layer == null || input.layer?.unitType === e.unitType)
  const free = 100 - new Set(input.layer?.usedSlices).size
  add('layer-full', e.layer == null || !!input.layer && free >= e.allocation, { available: free, requested: e.allocation })
  const unknown = input.metrics.filter(metric => !metric.source.startsWith('events:') && !input.metricSources?.some(source => source.id === metric.source))
  add('unknown-metric-source', unknown.length === 0, unknown)
  const mismatches = input.metrics.filter(metric => !metric.source.startsWith('events:') && e.unitType === 'user' && input.metricSources?.some(source => source.id === metric.source && source.keyedBy === 'visitor'))
  add('unit-source-mismatch', mismatches.length === 0, mismatches)
  const pathRules = (e.targeting ?? []).flatMap((rule, index) => rule.attribute === 'path' ? [index] : [])
  add('block-path-rule', e.kind !== 'block' || pathRules.length === 0, { rules: pathRules })
  const undeclared = (e.targeting ?? []).filter(rule => !Object.hasOwn(input.attributeKeys ?? {}, rule.attribute))
  add('undeclared-targeting-key', undeclared.length === 0, { message: 'Targeting uses an undeclared attribute.', attributes: undeclared.map(rule => rule.attribute) })
  const invalidRules = (e.targeting ?? []).filter(rule => {
    const type = Object.hasOwn(input.attributeKeys ?? {}, rule.attribute) ? input.attributeKeys![rule.attribute]!.type : undefined
    if (!type) return false // Report undeclared keys through their own refusal.
    const validValue = type === 'string' && ['in', 'nin'].includes(rule.op)
      ? Array.isArray(rule.value) && rule.value.length > 0 && rule.value.every(value => typeof value === 'string')
      : typeof rule.value === type && (type !== 'number' || Number.isFinite(rule.value))
    return !isOpValid(type, rule.op) || !validValue
  })
  add('invalid-targeting-rule', invalidRules.length === 0, { attributes: invalidRules.map(rule => rule.attribute) })
  return checks
}

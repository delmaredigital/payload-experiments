import type { ReadinessCode, PreflightResult } from '../../../types/endpoints.js'
import type { SerializedFlagPoint } from '../../../types/admin.js'
import type { TestDocument } from '../testDocument.model.js'
import { formatDate } from '../../format/date.js'
import { actionGroupLabel } from '../../actions/actions.model.js'
import { placementFailureCopy, unpublishedPageCopy, READINESS_COPY as C, attributeNext, contentNext, goalPeopleNext, parameterNext, placementNext, ruleNext, versionsNext } from '../../copy/readiness.js'

import { SECTION_ORDER, type SectionId } from '../contracts.js'
export type ReadinessContext = Pick<TestDocument, 'arms' | 'unitType' | 'flagPoint'> & {
  flagPoints?: readonly Pick<SerializedFlagPoint, 'id' | 'params'>[]
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const first = (value: unknown): Record<string, unknown> => object(Array.isArray(value) ? value[0] : value)
const text = (value: unknown, fallback: string): string => typeof value === 'string' && value.trim() ? value.trim() : fallback
const detailText = (value: unknown, fallback: string): string => typeof value === 'string' ? text(value, fallback) : text(first(value).message ?? first(value).detail, fallback)
const group = (key: unknown, ctx: ReadinessContext): string => {
  const found = ctx.arms.find(item => item.key === key)
  return found ? actionGroupLabel(found.key, found.label) : C.groupFallback
}
const row = (section: SectionId | 'header', next: (detail: unknown, ctx: ReadinessContext) => string | null) => ({ section, next })
const versions = row('versions', detail => versionsNext(detailText(detail, C.versionFallback)))

/** Exhaustive mapping of the checkStart ReadinessCode union, including all ten invariant checks. */
export const READINESS: Record<ReadinessCode, { section: SectionId | 'header'; next(detail: unknown, ctx: ReadinessContext): string | null }> = {
  'invalid-status': row('header', () => null),
  'no-placements': row('what', detail => detail === undefined ? C.noPlacements : placementFailureCopy(detail)),
  'empty-slot': row('versions', (detail, ctx) => {
    const placements = Array.isArray(detail) ? detail : []
    const missing = ctx.arms.find(item => item.kind !== 'holdout' && placements.some(placement => {
      const slots = object(object(placement).slots)
      return !item.slot || !(typeof slots[item.slot] === 'number' && Number(slots[item.slot]) > 0)
    }))
    return contentNext(group(missing?.key ?? first(detail).arm, ctx))
  }),
  'flag-no-point': row('what', () => C.noPoint),
  'flag-params-invalid': row('versions', (detail, ctx) => {
    const issue = first(detail)
    const point = ctx.flagPoints?.find(item => item.id === ctx.flagPoint)
    const parameter = typeof issue.field === 'string' ? point?.params[issue.field]?.label ?? issue.field : C.parameterFallback
    return parameterNext(parameter, group(issue.arm, ctx))
  }),
  'flag-point-busy': row('what', () => C.busy),
  'flag-placement-missing': row('versions', (detail, ctx) => {
    if (typeof detail === 'string') return placementFailureCopy(detail)
    const value = object(detail)
    const placement = first(value.placements)
    const missing = Array.isArray(value.missing) ? value.missing[0] : undefined
    return placementNext(group(placement.arm ?? missing, ctx), detailText(typeof detail === 'string' ? detail : placement, ''))
  }),
  'no-primary-metric': row('win', () => C.noGoal),
  'unknown-metric-source': row('win', () => C.unknownGoal),
  'unit-source-mismatch': row('win', (_, ctx) => goalPeopleNext(ctx.unitType === 'user' ? 'signed-in users' : 'visitors')),
  'no-planned-duration': row('length', () => C.noDuration),
  'no-reach-per-day': row('length', () => C.noReach),
  'layer-full': row('versions', () => C.full),
  'layer-unit-mismatch': row('header', () => C.differentPeople),
  'page-no-targets': row('versions', () => C.noTargets),
  'page-target-unpublished': row('versions', detail => unpublishedPageCopy(text(detail, 'This page'))),
  'page-targets-unchecked': row('versions', () => C.uncheckedPages),
  'page-user-unit': row('header', () => C.pageVisitors),
  'invalid-targeting-rule': row('who', detail => {
    const attributes = object(detail).attributes
    return ruleNext(detailText(detail, Array.isArray(attributes) && attributes.length ? attributes.map(String).join(', ') : C.ruleFallback))
  }),
  'undeclared-targeting-key': row('who', detail => {
    const attributes = object(detail).attributes
    return attributeNext(text(Array.isArray(attributes) ? attributes[0] : object(detail).attribute, C.attributeFallback))
  }),
  'weights-total': versions, 'control-count': versions, 'control-first': versions, 'holdout-count': versions,
  'holdout-last': versions, 'variant-count': versions, 'invalid-key': versions, 'duplicate-key': versions,
  'slot-required': versions, 'duplicate-slot': versions,
}

export function nextStep(preflight: PreflightResult | null, ctx: ReadinessContext) {
  for (const section of ['header', ...SECTION_ORDER] as const) {
    for (const check of preflight?.checks ?? []) {
      const mapping = READINESS[check.code]
      if (check.ok || mapping.section !== section) continue
      const sentence = mapping.next(check.detail, ctx)
      if (sentence) return { section, sentence, code: check.code }
    }
  }
  return null
}

export function sectionDone(test: { preflight: PreflightResult | null }): Record<SectionId, boolean> {
  return Object.fromEntries(SECTION_ORDER.map(section => [section,
    test.preflight ? !test.preflight.checks.some(check => !check.ok && READINESS[check.code].section === section)
      : section === 'who' || section === 'advanced',
  ])) as Record<SectionId, boolean>
}

export function displayDate(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null
  return formatDate(value)
}

export function daysRemaining(doc: TestDocument, now: number): number | null {
  const days = doc.analysis?.plannedDurationDays
  const start = typeof doc.startedAt === 'string' ? Date.parse(doc.startedAt) : NaN
  return typeof days === 'number' && days > 0 && Number.isFinite(start) ? Math.max(0, Math.ceil(days - (now - start) / 86_400_000)) : null
}

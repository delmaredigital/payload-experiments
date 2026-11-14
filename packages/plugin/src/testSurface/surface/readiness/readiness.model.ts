import { SURFACE_COPY } from '../../copy/surface.js'
import type { ReadinessCode, PreflightResult } from '../../../types/endpoints.js'
import type { SerializedFlagPoint } from '../../../types/admin.js'
import type { TestDocument } from '../testDocument.model.js'
import { formatDate } from '../../format/date.js'
import { actionGroupLabel } from '../../actions/actions.model.js'
import { asymmetricGoalsCopy, placementUncheckedCopy, interactingTestsCopy, sameAddressCopy, identicalVersionCopy, unsupportedContentCopy, versionPageUnavailableCopy, versionPageUncheckedCopy, placementFailureCopy, pageInUseCopy, unpublishedPageCopy, READINESS_COPY as C, attributeNext, contentNext, goalPeopleNext, parameterNext, placementNext, ruleNext, versionsNext } from '../../copy/readiness.js'

import { normalisePath } from '../../../runtime/normalisePath.js'
import { testPageCollection } from '../pagePicker/pagePicker.model.js'
import type { SurfaceProps } from '../contracts.js'
import { SECTION_ORDER, type SectionId } from '../contracts.js'
export type ReadinessContext = Pick<TestDocument, 'arms' | 'unitType' | 'flagPoint'> & {
  editorPlacementMessage?: string
  collectionLabel?: string
  pagePlacements?: PreflightResult['pagePlacements']
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
export const READINESS: Record<ReadinessCode, { section: SectionId | 'header'; next(detail: unknown, ctx: ReadinessContext): string | null; nextStep?: string | ((detail: unknown, ctx: ReadinessContext) => string) }> = {
  'make-content-unsupported': row('header', detail => unsupportedContentCopy(text(detail, 'This page'))),
  'goal-in-some-versions': { ...row('win', detail => asymmetricGoalsCopy(detail)), nextStep: 'Edit the versions' },
  'placement-unchecked': { ...row('versions', detail => placementUncheckedCopy(text(object(detail).title ?? object(detail).path, 'This page'))), nextStep: detail => `Open ${text(object(detail).title ?? object(detail).path, 'the page')}` },
  'invalid-status': row('header', () => null),
  'no-placements': row('what', (detail, ctx) => ctx.editorPlacementMessage ?? (detail === undefined ? C.noPlacements : placementFailureCopy(detail))),
  'placement-removed': row('what', () => C.placementRemoved),
  'placement-unpublished': { ...row('versions', detail => (Array.isArray(detail) && detail.length ? detail : [detail]).map(placement => `The block you're testing is only on a draft of ${text(object(placement).title, 'this page')}. Publish the page before you start.`).join('\n')), nextStep: 'Publish the page' },
  'duplicate-version-row': { ...row('versions', detail => `The Experiment block on ${text(first(detail).title, 'this page')} has the same version twice. Remove one of them, then save.`), nextStep: detail => `Edit ${text(first(detail).title, 'this page')}` },
  'interacting-tests': { ...row('versions', detail => interactingTestsCopy(text(first(detail).path, 'this page'), text(first(detail).status, 'running'), text(first(detail).name, 'another test'), first(detail).version === true)), nextStep: detail => `Open ${text(first(detail).name, 'the test')}${first(detail).version === true ? `\nEdit ${text(first(detail).path, 'this page')}` : ''}` },
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
  'page-in-use': { ...row('versions', (detail, ctx) => {
    const paths = object(detail).paths
    const path = text(Array.isArray(paths) ? paths[0] : undefined, 'this page')
    return pageInUseCopy(path, pageArm(path, ctx)?.kind === 'variant')
  }), nextStep: C.choosePages },
  'page-no-targets': { ...row('versions', () => C.noTargets), nextStep: 'Choose pages' },
  'unknown-collection': row('versions', () => "That page type isn't set up for tests."),
  'version-identical': { ...row('versions', (detail, ctx) => identicalVersionCopy(text(object(detail).path, object(detail).title ? `${group(object(detail).arm, ctx)} on ${text(object(detail).title, 'this page')}` : group(object(detail).arm, ctx)))), nextStep: (detail, ctx) => `Edit ${text(object(detail).path, group(object(detail).arm, ctx))}` },
  'version-same-address': { ...row('versions', (detail, ctx) => sameAddressCopy(group(object(detail).arm, ctx), group(object(detail).otherArm, ctx), text(object(detail).path, 'this address'), ctx.collectionLabel)), nextStep: 'Choose pages' },
  'page-target-unpublished': { ...row('versions', (detail, ctx) => {
    const path = text(typeof detail === 'string' ? detail : object(detail).path, 'This page')
    const arm = ctx.arms.find(item => item.key === object(detail).arm) ?? pageArm(path, ctx)
    const placement = (arm ? ctx.pagePlacements?.find(entry => entry.arm === arm.key) : undefined)
      ?? ctx.pagePlacements?.find(entry => normalisePath(entry.path) === normalisePath(path))
    return unpublishedPageCopy(path, ctx.pagePlacements && ctx.collectionLabel ? { original: arm?.kind === 'control', found: placement?.id != null && placement.published === false, collection: ctx.collectionLabel } : undefined)
  }), nextStep: C.choosePages },
  'page-targets-unchecked': row('versions', () => C.uncheckedPages),
  'version-page-unavailable': row('versions', detail => versionPageUnavailableCopy(text(detail, 'This page'))),
  'version-page-unchecked': row('versions', detail => versionPageUncheckedCopy(text(detail, 'This page'))),
  'page-user-unit': row('header', () => C.pageVisitors),
  'block-path-rule': { ...row('who', () => C.blockPathRule), nextStep: C.removeRule },
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

export function blockingSteps(preflight: PreflightResult | null, ctx: ReadinessContext) {
  return (['header', ...SECTION_ORDER] as const).flatMap(section => (preflight?.checks ?? []).flatMap(check => {
    const mapping = Object.hasOwn(READINESS, check.code) ? READINESS[check.code] : undefined
    if (check.ok || (mapping?.section ?? 'what') !== section) return []
    const sentence = mapping ? mapping.next(check.detail, ctx) : SURFACE_COPY.next
    const arm = readinessArm(check.code, check.detail, ctx)
    return sentence ? [{ section, sentence, code: check.code, ...(arm ? { arm } : {}) }] : []
  }))
}
export function nextStep(preflight: PreflightResult | null, ctx: ReadinessContext) {
  const next = blockingSteps(preflight, ctx)[0]
  if (!next) return null
  const mapping = READINESS[next.code]
  const detail = preflight?.checks.find(check => !check.ok && check.code === next.code)?.detail
  const action = mapping && (typeof mapping.nextStep === 'function' ? mapping.nextStep(detail, ctx) : mapping.nextStep)
  return { ...next, ...(action ? { nextStep: action } : {}) }
}
export function errorSection(path: string): SectionId | undefined {
  if (['name', 'hypothesis', 'flagPoint'].some(field => path === field || path.startsWith(`${field}.`))) return 'what'
  if (/^(arms|pageCollection|allocation)(\.|$)/.test(path)) return 'versions'
  if (/^metrics(\.|$)/.test(path)) return 'win'
  if (/^(targeting)(\.|$)/.test(path)) return 'who'
  if (/^analysis\.(plannedDurationDays|reachPerDay)(\.|$)/.test(path)) return 'length'
  if (/^(analysis|exposurePolicy|layer)(\.|$)/.test(path)) return 'advanced'
}
export function sectionBlocked(test: { preflight: PreflightResult | null; errors?: Record<string, string> }, section: SectionId) {
  if (Object.keys(test.errors ?? {}).some(path => errorSection(path) === section)) return true
  return !!test.preflight?.checks.some(check => !check.ok && (Object.hasOwn(READINESS, check.code) ? READINESS[check.code].section : 'what') === section)
}

export function sectionDone(test: { preflight: PreflightResult | null; doc?: Pick<TestDocument, 'targeting'> | null }): Record<SectionId, boolean> {
  return Object.fromEntries(SECTION_ORDER.map(section => [section,
    section === 'who' && test.doc && !test.doc.targeting?.length ? false : test.preflight ? !test.preflight.checks.some(check => !check.ok && (Object.hasOwn(READINESS, check.code) ? READINESS[check.code].section : SECTION_ORDER[0]) === section)
      : section === 'advanced',
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

function pageArm(path: string, ctx: ReadinessContext) {
  return ctx.arms.find(arm => arm.pageTarget && normalisePath(arm.pageTarget) === normalisePath(path))
}
export function pageReadinessContext(doc: TestDocument, preflight: PreflightResult | null, surface: SurfaceProps): ReadinessContext {
  return { ...doc, editorPlacementMessage: surface.editorPlacementMessage, flagPoints: surface.flagPoints, pagePlacements: preflight?.pagePlacements,
    collectionLabel: testPageCollection(surface.pageCollections, doc, preflight?.pagePlacements)?.label }
}
/** First affected row in arm order; shared by the wizard and the test-page jump. */
export function readinessArm(code: ReadinessCode, detail: unknown, ctx: ReadinessContext) {
  if (code === 'version-same-address') return ctx.arms.find(arm => arm.key === object(detail).arm)?.key
  if (code === 'page-no-targets') return ctx.arms.find(arm => arm.kind !== 'holdout' && !arm.pageTarget)?.key
  const paths = code === 'page-in-use' ? object(detail).paths : code === 'page-target-unpublished' ? [detail] : []
  return ctx.arms.find(arm => arm.kind !== 'holdout' && arm.pageTarget && Array.isArray(paths) && paths.some(path => typeof path === 'string' && normalisePath(path) === normalisePath(arm.pageTarget!)))?.key
}

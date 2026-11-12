import type { Arm, DocId, Status, UnitType } from '../../types/contracts.js'
import type { ArmSlot } from '../../types/puck.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { splitEvenly } from '../../arms/model.js'
import { editorCopy } from './copy.js'

export type EditorExperiment = {
  name: string
  updatedAt?: string
  status: Status
  arms: Array<Pick<Arm, 'key' | 'kind' | 'label'> & Partial<Arm>>
  decision?: { winnerArm?: string } | null
}

export function tabsFor(experiment?: Pick<EditorExperiment, 'arms'> | null): Array<{ slot: ArmSlot; label: string }> {
  if (!experiment) return [{ slot: 'control', label: editorCopy.labels.control }]
  return experiment.arms.flatMap(arm => arm.kind === 'holdout' || arm.key === 'holdout'
    ? [] : [{ slot: arm.key, label: arm.label.trim() || editorCopy.labels[arm.key] }])
    .sort((a, b) => Number(b.slot === 'control') - Number(a.slot === 'control'))
}

export function bannerFor(status?: Status | null, winner: string = editorCopy.labels.control): string {
  switch (status) {
    case 'draft': case 'stopped': return editorCopy.draft
    case 'running': return editorCopy.running
    case 'decided': return editorCopy.decided(winner)
    case 'archived': return editorCopy.archived
    default: return editorCopy.unbound
  }
}

/** Preserve the block's populated slots and the current test's versions, without carrying test settings. */
export function armsFromBlock(experiment: Pick<EditorExperiment, 'arms'>, content: Partial<Record<ArmSlot, unknown>>): Arm[] {
  const slots = ['control', 'variantA', 'variantB', 'variantC'] as const
  return splitEvenly(slots.flatMap(slot => {
    const arm = experiment.arms.find(arm => arm.key === slot && arm.kind !== 'holdout')
    if (slot !== 'control' && !arm && !(Array.isArray(content[slot]) && content[slot].length > 0)) return []
    return [{ key: slot, slot, kind: slot === 'control' ? 'control' as const : 'variant' as const,
      label: arm?.label.trim() || editorCopy.labels[slot], weight: 0 }]
  }))
}

/** Like the test page's placement count, draft and published copies count only once. */
export function isSharedTest(placements: PreflightResult['placements']): boolean {
  const pages = new Map<string, Map<string | undefined, number>>()
  for (const placement of placements) {
    const key = JSON.stringify([placement.collection, String(placement.id)])
    const versions = pages.get(key) ?? new Map<string | undefined, number>()
    const count = (versions.get(placement.detail) ?? 0) + 1
    versions.set(placement.detail, count)
    pages.set(key, versions)
    if (pages.size > 1 || count > 1) return true
  }
  return false
}

export function slugify(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '')
}

/** Complete draft defaults, shared by the page hand-off and setting creation. */
export function newTestBody(input: {
  kind: 'block' | 'flag' | 'page'; name: string; slug: string; unitType: UnitType
  pageCollection?: string; flagPoint?: string; layer?: DocId; hypothesis?: string
  arms?: Arm[]
}) {
  const { kind, name, slug, unitType, flagPoint, layer, hypothesis, pageCollection } = input
  const arms: Arm[] = input.arms?.map(arm => ({ ...arm })) ?? [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, ...(kind === 'block' ? { slot: 'control' as const } : {}) },
    { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, ...(kind === 'block' ? { slot: 'variantA' as const } : {}) },
  ]
  return { name, slug, kind, unitType: kind === 'page' ? 'visitor' : unitType, exposurePolicy: kind === 'block' ? 'render' : kind === 'page' ? 'pageview' : 'manual', arms,
    allocation: 100, analysis: { plannedDurationDays: 28 },
    ...(pageCollection === undefined ? {} : { pageCollection }),
    ...(flagPoint === undefined ? {} : { flagPoint }), ...(layer === undefined ? {} : { layer }),
    ...(hypothesis === undefined ? {} : { hypothesis }) }
}

/** Candidate order shared by local naming and the bounded REST slug probes. */
export function slugCandidate(base: string, index: number): string {
  const root = base.slice(0, 64).replace(/-+$/g, '') || 'test'
  if (index === 1) return root
  const suffix = `-${index}`
  return root.slice(0, 64 - suffix.length).replace(/-+$/g, '') + suffix
}

export function uniqueSlug(base: string, taken: readonly string[]): string {
  const used = new Set(taken)
  for (let index = 1; ; index++) {
    const candidate = slugCandidate(base, index)
    if (!used.has(candidate)) return candidate
  }
}

/** Payload nests field validation errors under data.errors. Only a unique slug refusal is retryable. */
export function isSlugCollision(status: number, body: unknown): boolean {
  if (status !== 400 || !body || typeof body !== 'object') return false
  const error = body as { path?: unknown; field?: unknown; message?: unknown; errors?: unknown; data?: unknown }
  const message = typeof error.message === 'string' ? error.message : ''
  if ((error.path === 'slug' || error.field === 'slug' || /\bslug\b/i.test(message)) && /unique|already.*(?:use|exist)|duplicate/i.test(message)) return true
  return Array.isArray(error.errors) && error.errors.some(item => isSlugCollision(status, item)) || isSlugCollision(status, error.data)
}

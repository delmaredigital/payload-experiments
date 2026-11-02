import type { Arm, DocId, Status, UnitType } from '../../types/contracts.js'
import type { ArmSlot } from '../../types/puck.js'
import { editorCopy } from './copy.js'

export type EditorExperiment = {
  name: string
  status: Status
  arms: Array<Pick<Arm, 'key' | 'kind' | 'label'>>
  decision?: { winnerArm?: string } | null
}

export function tabsFor(experiment?: Pick<EditorExperiment, 'arms'> | null): Array<{ slot: ArmSlot; label: string }> {
  if (!experiment) return [{ slot: 'control', label: editorCopy.labels.control }]
  return experiment.arms.flatMap(arm => arm.kind === 'holdout' || arm.key === 'holdout'
    ? [] : [{ slot: arm.key, label: arm.label?.trim() ? arm.label : editorCopy.labels[arm.key] }])
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

export function slugify(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '')
}

/** Complete draft defaults, shared by the page hand-off and setting creation. */
export function newTestBody(input: {
  kind: 'block' | 'flag'; name: string; slug: string; unitType: UnitType
  flagPoint?: string; layer?: DocId; hypothesis?: string
}) {
  const { kind, name, slug, unitType, flagPoint, layer, hypothesis } = input
  const arms: Arm[] = [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, ...(kind === 'block' ? { slot: 'control' as const } : {}) },
    { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, ...(kind === 'block' ? { slot: 'variantA' as const } : {}) },
  ]
  return { name, slug, kind, unitType, exposurePolicy: kind === 'block' ? 'render' : 'manual', arms,
    allocation: 100, analysis: { plannedDurationDays: 28 },
    ...(flagPoint === undefined ? {} : { flagPoint }), ...(layer === undefined ? {} : { layer }),
    ...(hypothesis === undefined ? {} : { hypothesis }) }
}

export function uniqueSlug(base: string, taken: readonly string[]): string {
  const root = base.slice(0, 64).replace(/-+$/g, '') || 'test'
  const used = new Set(taken)
  if (!used.has(root)) return root
  for (let index = 2; ; index++) {
    const suffix = `-${index}`
    const candidate = root.slice(0, 64 - suffix.length).replace(/-+$/g, '') + suffix
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

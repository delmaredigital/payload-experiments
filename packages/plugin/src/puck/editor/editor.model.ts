import type { Arm, Status } from '../../types/contracts.js'
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

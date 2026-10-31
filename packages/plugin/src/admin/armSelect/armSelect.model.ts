import type { Arm, DocId, Status } from '../../types/contracts.js'
import { ARM_SELECT_COPY, staleExperiment } from '../copy/armSelect.js'

export type ArmSelectExperiment = {
  id: DocId; name: string; status: Status; arms: Pick<Arm, 'key' | 'kind' | 'label'>[]
}
export type ExperimentReference = DocId | { id: DocId; name?: string }
export type StoredArmSelect = { experiment?: ExperimentReference | null; arm?: string | null }
export function experimentId(reference: ExperimentReference | null | undefined): DocId | null {
  return reference == null ? null : typeof reference === 'object' ? reference.id : reference
}

export function bindArmSelect({ live, candidates, stored }: {
  live?: ArmSelectExperiment | null; candidates: readonly ArmSelectExperiment[]; stored: StoredArmSelect
}) {
  const id = experimentId(stored.experiment)
  const previous = candidates.find(candidate => id != null && String(candidate.id) === String(id))
  const bound = live ?? previous ?? null
  const oldName = typeof stored.experiment === 'object' ? stored.experiment?.name : undefined
  return {
    bound, pickable: !live,
    options: (bound?.arms ?? []).filter(arm => arm.kind !== 'holdout').map(arm => ({ label: arm.label, value: arm.key })),
    stale: id != null && (bound == null || String(id) !== String(bound.id))
      ? staleExperiment(previous?.name ?? oldName ?? ARM_SELECT_COPY.earlier) : null,
    banner: bound?.status === 'running' ? ARM_SELECT_COPY.running : null,
  }
}

import { checkArms } from '../../collections/experiments/armInvariants.js'
import { issueMessage } from '../../arms/copy.js'
import { totalWeight, withSlotsFor } from '../../arms/model.js'
import { XP_IF_UPDATED_AT_HEADER } from '../../constants.js'
import type { Arm } from '../../types/contracts.js'
import type { EditorExperiment } from './editor.model.js'
import { editorCopy, writeRefusal } from './copy.js'

export class ArmWriteError extends Error {}

type WritableExperiment = EditorExperiment & { arms: Arm[]; updatedAt: string }
export async function readExperiment(url: string, signal?: AbortSignal): Promise<EditorExperiment> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...(signal ? { signal } : {}) })
  if (!response.ok) throw new ArmWriteError(writeRefusal(undefined, response.status))
  const doc: unknown = await response.json().catch(() => undefined)
  if (!doc || typeof doc !== 'object') throw new ArmWriteError(editorCopy.writeUnreadable)
  const value = doc as WritableExperiment
  if (typeof value.name !== 'string' || typeof value.status !== 'string' || typeof value.updatedAt !== 'string' || !value.updatedAt ||
    !Array.isArray(value.arms) || !value.arms.length || value.arms.some(arm => !arm || typeof arm !== 'object' ||
      !Object.hasOwn(editorCopy.labels, arm.key) && arm.key !== 'holdout' || !['control', 'variant', 'holdout'].includes(arm.kind) ||
      typeof arm.label !== 'string' || typeof arm.weight !== 'number' || !Number.isFinite(arm.weight))) throw new ArmWriteError(editorCopy.writeUnreadable)
  if (!['draft', 'stopped', 'running', 'decided', 'archived'].includes(value.status)) throw new ArmWriteError(editorCopy.lockedGeneric)
  return value
}

/** Each intent is applied to a fresh document, guarded by the collection's compare-and-set header. */
export async function writeArms(url: string, transform: (arms: Arm[]) => Arm[], publish: (doc: EditorExperiment) => void, { draftOnly = false }: { draftOnly?: boolean } = {}): Promise<Arm[]> {
  const fresh = await readExperiment(`${url}?depth=0`) as WritableExperiment
  publish(fresh)
  if (draftOnly && fresh.status !== 'draft') throw new ArmWriteError(editorCopy.draftOnly)
  if (fresh.status !== 'draft' && fresh.status !== 'stopped') throw new ArmWriteError(editorCopy.locked[fresh.status])
  if (!fresh.updatedAt || !Array.isArray(fresh.arms)) throw new ArmWriteError(editorCopy.writeUnreadable)
  const arms = withSlotsFor(transform(fresh.arms), 'block')
  const issue = checkArms(arms, 'block')[0]
  if (issue) throw new ArmWriteError(issueMessage(issue, totalWeight(arms)))
  if (arms.some(arm => !arm.label.trim())) throw new ArmWriteError(editorCopy.emptyLabel)
  const response = await fetch(url, {
    method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', [XP_IF_UPDATED_AT_HEADER]: fresh.updatedAt },
    body: JSON.stringify({ arms }),
  })
  const body = await response.json().catch(() => undefined) as { doc?: EditorExperiment; errors?: Array<{ code?: string }> } | undefined
  if (!response.ok) {
    const codes = Array.isArray(body?.errors) ? body.errors : []
    const stale = response.status === 409 && codes.some(error => error?.code === 'stale-edit')
    if (stale) {
      try { publish(await readExperiment(`${url}?depth=0`)) } catch { /* Keep the mapped stale refusal even if the recovery read fails. */ }
    }
    throw new ArmWriteError(stale ? editorCopy.staleEdit : writeRefusal(codes[0]?.code, response.status))
  }
  // A successful PATCH is applied even when its response body is unavailable.
  publish(body?.doc ?? { ...fresh, arms })
  return arms
}

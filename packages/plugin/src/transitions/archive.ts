import type { PayloadRequest } from 'payload'
import type { DocId } from '../types/contracts.js'
import type { ArchiveBody } from '../types/endpoints.js'
import { relationshipId } from './checkStart.js'
import { expectedConfirm, matchesConfirm, storedWinnerLabel } from './confirmPhrases.js'
import { withTransition } from './kernel.js'
import { setPhaseEndedAt } from './phaseRecord.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

export async function archive(req: PayloadRequest, { experimentId, mode, confirmation }: ArchiveBody & { experimentId: DocId }) {
  const before = await readExperiment(req, experimentId)
  const { result: doc, revision } = await withTransition(req, { experimentId, layerId: relationshipId(before.layer) }, async ({ req }) => {
    const current = await readExperiment(req, experimentId)
    const decision = current.decision as Record<string, unknown> | undefined
    if (mode === 'stopped' ? current.status !== 'stopped' : current.status !== 'decided') refuse('invalid-status')
    if (mode === 'hard-coded' && current.kind !== 'code') refuse('invalid-status')
    if (mode === 'after-content') {
      const report = decision?.contentReport as { docs?: Array<{ ok?: boolean; dismissedAt?: string }> } | Array<{ ok?: boolean; dismissedAt?: string }> | undefined
      const docs = Array.isArray(report) ? report : report?.docs
      if (!Array.isArray(docs) || !docs.every(doc => doc?.ok === true || doc?.dismissedAt)) refuse('invalid-status')
    }
    if (mode === 'discard' && !matchesConfirm(expectedConfirm('discard', ''), confirmation)) refuse('confirmation-required')
    if (mode === 'hard-coded') {
      const winner = current.arms.find(arm => arm.key === decision?.winnerArm && arm.kind !== 'holdout')
      if (!winner) refuse('invalid-winner')
      if (!matchesConfirm(expectedConfirm('hard-coded', storedWinnerLabel(winner)), confirmation)) refuse('confirmation-required')
    }
    const at = new Date().toISOString()
    await setPhaseEndedAt(req, experimentId, current.phase!, at)
    return updateExperiment(req, experimentId, { status: 'archived', archivedAt: at, layerSlices: [],
      ...(mode === 'discard' ? { decision: { ...decision, winnerArm: null, discardedAt: at } } : {}) })
  })
  return { doc, revision: revision! }
}

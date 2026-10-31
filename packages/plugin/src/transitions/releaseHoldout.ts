import type { PayloadRequest } from 'payload'
import type { DocId } from '../types/contracts.js'
import { relationshipId } from './checkStart.js'
import { withTransition } from './kernel.js'
import { readPhaseRecord, setPhaseEndedAt } from './phaseRecord.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

export async function releaseHoldout(req: PayloadRequest, { experimentId }: { experimentId: DocId }) {
  const before = await readExperiment(req, experimentId)
  const { result: doc, revision } = await withTransition(req, { experimentId, layerId: relationshipId(before.layer) }, async ({ req }) => {
    const current = await readExperiment(req, experimentId)
    const decision = current.decision as Record<string, unknown> | undefined
    if (current.status !== 'decided' || !decision?.winnerArm || decision.holdoutReleasedAt) refuse('invalid-status')
    const phase = await readPhaseRecord(req, experimentId, current.phase!)
    if (phase.phaseKind !== 'rollout' || phase.endedAt) refuse('invalid-status')
    const at = new Date().toISOString()
    await setPhaseEndedAt(req, experimentId, phase.phase, at)
    return updateExperiment(req, experimentId, { layerSlices: [], decision: { ...decision, holdoutReleasedAt: at } })
  })
  return { doc, revision: revision! }
}

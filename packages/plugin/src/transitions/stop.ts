import type { PayloadRequest } from 'payload'
import type { DocId } from '../types/contracts.js'
import { relationshipId } from './checkStart.js'
import { withTransition } from './kernel.js'
import { setPhaseEndedAt } from './phaseRecord.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

export async function stop(req: PayloadRequest, { experimentId }: { experimentId: DocId }) {
  const before = await readExperiment(req, experimentId)
  const { result: doc, revision } = await withTransition(req, { experimentId, layerId: relationshipId(before.layer) }, async ({ req }) => {
    const current = await readExperiment(req, experimentId)
    if (current.status !== 'running') refuse('invalid-status')
    const at = new Date().toISOString()
    await setPhaseEndedAt(req, experimentId, current.phase!, at)
    return updateExperiment(req, experimentId, { status: 'stopped', layerSlices: [], stoppedAt: at })
  })
  return { doc, revision: revision! }
}

import type { PayloadRequest } from 'payload'
import type { DocId } from '../types/contracts.js'
import { relationshipId } from './checkStart.js'
import { withTransition } from './kernel.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

export async function releasePages(req: PayloadRequest, { experimentId }: { experimentId: DocId }) {
  const before = await readExperiment(req, experimentId)
  const { result: doc, revision } = await withTransition(req, { experimentId, layerId: relationshipId(before.layer) }, async ({ req }) => {
    const current = await readExperiment(req, experimentId)
    const decision = current.decision as Record<string, unknown> | undefined
    if (current.kind !== 'page' || current.status !== 'archived' || !decision?.winnerArm || decision.discardedAt || decision.pagesReleasedAt) refuse('invalid-status')
    const at = new Date().toISOString()
    return updateExperiment(req, experimentId, { decision: { ...decision, pagesReleasedAt: at, pagesReleasedBy: req.user ? String(req.user.id) : null } })
  })
  return { doc, revision: revision! }
}

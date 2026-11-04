import type { PayloadRequest } from 'payload'
import type { DocId } from '../types/contracts.js'
import type { RestoreContentEntryBody, MakeContentResult } from '../types/endpoints.js'
import { relationshipId } from './checkStart.js'
import { withTransition } from './kernel.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

export async function restoreContentEntry(req: PayloadRequest, { experimentId, collection, id }: RestoreContentEntryBody & { experimentId: DocId }) {
  const before = await readExperiment(req, experimentId)
  // Only the audit report changes; assignment and the manifest stay the same.
  const { result: doc } = await withTransition(req, { experimentId, layerId: relationshipId(before.layer),
    flagPointId: before.kind === 'flag' ? before.flagPoint : undefined, bump: false,
  }, async ({ req }) => {
    const current = await readExperiment(req, experimentId)
    const decision = current.decision as Record<string, unknown> | undefined
    const report = decision?.contentReport as { docs?: MakeContentResult['docs'] } | undefined
    const index = Array.isArray(report?.docs) ? report.docs.findIndex(entry => entry.collection === collection && String(entry.id) === String(id)) : -1
    const entry = report?.docs?.[index]
    if (current.status !== 'decided' || !decision?.winnerArm || decision.discardedAt) refuse('not-decided')
    if (!entry) refuse('entry-not-found')
    if (!entry.dismissedAt) refuse('entry-not-dismissed')
    const docs = report!.docs!.map((entry, i) => {
      if (i !== index) return entry
      const { dismissedAt: _at, dismissedBy: _by, ...restored } = entry
      return { ...restored, ok: false }
    })
    return updateExperiment(req, experimentId, { decision: { ...decision, contentReport: { ...report, docs } } })
  })
  req.payload.logger.info({ experimentId, collection, id }, 'Experiment content entry restored')
  return { doc }
}

import type { PayloadRequest } from 'payload'
import type { DocId } from '../types/contracts.js'
import type { DismissContentEntryBody, MakeContentResult } from '../types/endpoints.js'
import { relationshipId } from './checkStart.js'
import { withTransition } from './kernel.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

export async function dismissContentEntry(req: PayloadRequest, { experimentId, collection, id }: DismissContentEntryBody & { experimentId: DocId }) {
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
    if (entry.ok !== false) refuse('entry-ok')
    if (entry.dismissedAt) refuse('entry-dismissed')
    const docs = report!.docs!.map((entry, i) => i === index
      ? { ...entry, dismissedAt: new Date().toISOString(), dismissedBy: req.user?.id == null ? null : String(req.user.id) } : entry)
    return updateExperiment(req, experimentId, { decision: { ...decision, contentReport: { ...report, docs } } })
  })
  req.payload.logger.info({ experimentId, collection, id }, 'Experiment content entry dismissed')
  return { doc }
}

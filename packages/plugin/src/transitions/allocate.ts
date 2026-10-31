import { XpRefusal } from '../errors.js'
import type { PayloadRequest } from 'payload'
import { appendAllocationChange } from '../db/appends.js'
import { claimSlices } from '../db/slices.js'
import type { DocId } from '../types/contracts.js'
import { relationshipId } from './checkStart.js'
import { withTransition } from './kernel.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

export async function allocate(req: PayloadRequest, { experimentId, allocation }: { experimentId: DocId; allocation: number }) {
  if (!Number.isInteger(allocation) || allocation < 1 || allocation > 100) refuse('invalid-body')
  const before = await readExperiment(req, experimentId)
  const { result: doc, revision } = await withTransition(req, { experimentId, layerId: relationshipId(before.layer) }, async ({ req, exec }) => {
    const current = await readExperiment(req, experimentId)
    if (current.status !== 'running') refuse('invalid-status')
    if (allocation <= current.allocation) refuse('allocation-lower')
    const layerId = relationshipId(current.layer)
    const layerSlices = layerId === undefined ? [] : [...current.layerSlices ?? [], ...await claimSlices(exec, { layerId, experimentId, count: allocation - current.allocation })].sort((a, b) => a - b)
    await appendAllocationChange(exec, { experimentId, phase: current.phase!, entry: { at: new Date().toISOString(), from: current.allocation, to: allocation } })
    // The compiler reads coverage from the phase, so keep its current allocation
    // in sync while allocationChanges retains the full audit trail.
    // §7.8: phase lookup for the transition write.
    const phases = await req.payload.find({ collection: 'xp-phases', req, overrideAccess: true, depth: 0, limit: 1,
      where: { and: [{ experiment: { equals: experimentId } }, { phase: { equals: current.phase } }] } })
    if (!phases.docs[0]) throw new XpRefusal('not-found', 'The phase record was not found.', undefined, 404)
    // §7.8: transition writes the phase's widened coverage.
    await req.payload.update({ collection: 'xp-phases', req, overrideAccess: true, id: phases.docs[0].id, data: {
      allocation, analysis: { ...phases.docs[0].analysis as Record<string, unknown>, layerSlices },
    } })
    // Preserve seed, arms and existing slices: only coverage widens.
    return updateExperiment(req, experimentId, { allocation, layerSlices })
  })
  return { doc, revision: revision! }
}

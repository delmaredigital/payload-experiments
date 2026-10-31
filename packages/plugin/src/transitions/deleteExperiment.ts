import type { PayloadRequest } from 'payload'
import { txExecutor } from '../db/executor.js'
import { deleteExperimentEvents } from '../db/events.js'
import { lockTransitionScope } from '../db/locks.js'
import { buildAndStoreManifest } from '../manifest/compile.js'
import type { DocId } from '../types/contracts.js'
import { readExperiment, refuse } from './start.js'

/** Payload deleteByID owns the request transaction; never commit inside hooks. */
export async function deleteExperiment(req: PayloadRequest, experimentId: DocId): Promise<void> {
  const exec = txExecutor(req)
  await lockTransitionScope(exec, { experimentId })
  const current = await readExperiment(req, experimentId)
  if (current.status !== 'draft' && current.status !== 'archived') refuse('invalid-status')
  try {
    for (const collection of ['xp-phases', 'xp-results-snapshots'] as const) {
      // §7.8 transition exception: cascade while FK references still exist.
      const { docs } = await req.payload.find({ collection, req, overrideAccess: true, depth: 0, limit: 0,
        where: { experiment: { equals: experimentId } } })
      // deleteByID throws on a hook failure; bulk delete swallows per-doc errors.
      for (const doc of docs) {
        // §7.8: privileged plugin cascade shares the access-checked delete's req.
        await req.payload.delete({ collection, id: doc.id, req, overrideAccess: true })
      }
    }
    await deleteExperimentEvents(exec, experimentId)
  } catch (error) {
    req.payload.logger.error({ experimentId, err: error }, 'Experiment cascade failed; aborting delete')
    throw error
  }
}

export async function deleteExperimentAfter(req: PayloadRequest, experimentId: DocId): Promise<void> {
  await buildAndStoreManifest(req, { excludeIds: [experimentId] })
}

import { safeError } from '../log.js'
import type { PayloadRequest } from 'payload'
import { txExecutor } from '../db/executor.js'
import { deleteExperimentSnapshots, serializeDelete } from '../db/delete.js'
import { deleteExperimentEvents } from '../db/events.js'
import { lockTransitionScope } from '../db/locks.js'
import { buildAndStoreManifest } from '../manifest/compile.js'
import type { DocId } from '../types/contracts.js'
import { readExperiment, refuse } from './start.js'

/** Payload deleteByID owns the request transaction; never commit inside hooks. */
export async function deleteExperiment(req: PayloadRequest, experimentId: DocId): Promise<void> {
  await serializeDelete(req, async state => {
    const exec = txExecutor(req)
    await lockTransitionScope(exec, { experimentId })
    const current = await readExperiment(req, experimentId)
    if (current.status !== 'draft' && current.status !== 'archived') refuse('invalid-status')
    try {
      const collection = 'xp-phases'
      // §7.8 transition exception: cascade while FK references still exist.
      const { docs } = await req.payload.find({ collection, req, overrideAccess: true, depth: 0, limit: 0,
        where: { experiment: { equals: experimentId } } })
      // deleteByID throws on a hook failure; bulk delete swallows per-doc errors.
      for (const doc of docs) {
        // §7.8: privileged plugin cascade shares the access-checked delete's req.
        await req.payload.delete({ collection, id: doc.id, req, overrideAccess: true })
      }
      await deleteExperimentSnapshots(exec, experimentId)
      await deleteExperimentEvents(exec, experimentId)
      state.excludedIds.set(String(experimentId), experimentId)
      const decision = current.decision as { discardedAt?: string | null } | undefined
      if (current.status !== 'archived' || decision?.discardedAt) state.pruneFlagDefaultIds.set(String(experimentId), experimentId)
    } catch (error) {
      req.payload.logger.error({ experimentId, err: safeError(error) }, 'Experiment cascade failed; aborting delete')
      throw error
    }
  })
}

export async function deleteExperimentAfter(req: PayloadRequest, experimentId: DocId): Promise<void> {
  await serializeDelete(req, async state => {
    await buildAndStoreManifest(req, { excludeIds: [...state.excludedIds.values(), experimentId], pruneFlagDefaultIds: [...state.pruneFlagDefaultIds.values()] })
  })
}

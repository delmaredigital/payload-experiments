import { commitTransaction, initTransaction, killTransaction, type PayloadRequest } from 'payload'
import { lockContentDefaults } from '../db/appends.js'
import { pooledExecutor, txExecutor } from '../db/executor.js'
import { currentTxid, txidStatus } from '../db/txid.js'
import { buildAndStoreManifest } from '../manifest/compile.js'
import { puckCollections } from '../options.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'
import { archive } from './archive.js'
import { relationshipId } from './checkStart.js'
import { withTransition } from './kernel.js'
import { scanBlockPlacements } from './placements.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

type ContentDoc = { collection: string; id: DocId; ok: boolean; detail?: string; error?: string }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Flatten selected slots in every content array, including nested selected slots. */
function unwrap(value: unknown, slug: string, slot: string): unknown {
  if (Array.isArray(value)) return value.flatMap(node => {
    if (object(node) && node.type === 'ExperimentSlot' && object(node.props)) {
      const ref = node.props.experiment
      if ((typeof ref === 'string' ? ref : object(ref) ? ref.slug : undefined) === slug) {
        const content = node.props[slot]
        if (!Array.isArray(content)) throw new Error('The winning content slot is missing.')
        return unwrap(content, slug, slot) as unknown[]
      }
    }
    return [unwrap(node, slug, slot)]
  })
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrap(child, slug, slot)]))
  return value
}

/** Payload update merges omissions from the latest version even on publish.
 * Restore each captured document's fields, omitting API/adapter metadata.
 */
function contentData(doc: Record<string, unknown>, field: string, content: unknown): Record<string, unknown> {
  const metadata = new Set(['id', 'createdAt', 'updatedAt', '_isLocked', '_userEditing'])
  return { ...Object.fromEntries(Object.entries(doc).filter(([key]) => !metadata.has(key))), [field]: content }
}

/** Each placement commits independently while the outer transition retains its
 * experiment locks. Keep the manager's exact req/user, temporarily lending it a
 * fresh transaction; a denied host write must not kill the outer transaction.
 */
async function hostTransaction(req: PayloadRequest, fn: () => Promise<void>): Promise<void> {
  const transactionID = req.transactionID
  const transition = req.context.xpTransition
  delete req.transactionID
  delete req.context.xpTransition
  try {
    if (!await initTransaction(req)) throw new Error('A content transaction could not be started.')
    await fn()
    const xid = await currentTxid(txExecutor(req))
    await commitTransaction(req)
    if (await txidStatus(pooledExecutor(req.payload), xid) !== 'committed') throw new Error('The content commit could not be verified. Retry to check the saved content.')
  } catch (error) {
    await killTransaction(req)
    throw error
  } finally {
    req.transactionID = transactionID
    if (transition === undefined) delete req.context.xpTransition
    else req.context.xpTransition = transition
  }
}

export async function makeContent<TUser extends { id: DocId }>(req: PayloadRequest, { experimentId, options }: { experimentId: DocId; options: ResolvedOptions<TUser> }) {
  const before = await readExperiment(req, experimentId)
  const { result } = await withTransition(req, { experimentId, layerId: relationshipId(before.layer),
    flagPointId: before.kind === 'flag' ? before.flagPoint : undefined, bump: false,
  }, async ({ exec }) => {
    const current = await readExperiment(req, experimentId)
    if (current.status !== 'decided' || !['block', 'flag', 'page'].includes(current.kind)) refuse('invalid-status')
    const decision = current.decision as Record<string, unknown> | undefined
    const winner = current.arms.find(arm => arm.key === decision?.winnerArm && arm.kind !== 'holdout')
    if (!winner) refuse('invalid-winner')
    const docs: ContentDoc[] = []
    const attempt = async (collection: string, id: DocId, fn: () => Promise<void>) => {
      try { await hostTransaction(req, fn); docs.push({ collection, id, ok: true }) }
      catch (error) {
        const detail = error instanceof Error ? error.message : 'The content could not be updated.'
        docs.push({ collection, id, ok: false, detail, error: detail })
      }
    }
    if (current.kind === 'block') {
      if (!winner.slot) refuse('invalid-winner')
      const scanned = await scanBlockPlacements(req, { slug: current.slug, puckCollections: options.puck?.collections ?? [] })
      if (scanned.some(doc => doc.locked)) refuse('locked-placement')
      const report = decision?.contentReport as { docs?: ContentDoc[] } | undefined
      const placements = new Map<string, { collection: string; id: DocId }>()
      for (const doc of [...(report?.docs ?? []), ...scanned]) placements.set(doc.collection + ':' + doc.id, doc)
      const registrations = puckCollections(options)
      // Refuse before any host write, including documents retained by a retry.
      for (const { collection, id } of placements.values()) {
        const doc = await req.payload.findByID({ collection, id, req, overrideAccess: false, depth: 0, draft: true, includeLockStatus: true })
        if (doc._isLocked === true || doc.locked === true) refuse('locked-placement', { collection, id })
      }
      for (const { collection, id } of placements.values()) await attempt(collection, id, async () => {
        const field = registrations.find(entry => entry.slug === collection)?.field
        if (!field) throw new Error('This content collection is no longer configured.')
        const draft = await req.payload.findByID({ collection, id, req, overrideAccess: false, depth: 0, draft: true })
        const drafts = req.payload.config.collections.some(config => config.slug === collection && config.versions && config.versions.drafts)
        const published = drafts ? await req.payload.findByID({ collection, id, req, overrideAccess: false, depth: 0, draft: false }) : draft
        const draftContent = unwrap(draft[field], current.slug, winner.slot!)
        const publishedContent = unwrap(published[field], current.slug, winner.slot!)
        const changedDraft = JSON.stringify(draftContent) !== JSON.stringify(draft[field])
        const changedPublished = JSON.stringify(publishedContent) !== JSON.stringify(published[field])
        if (!changedDraft && !changedPublished) return
        // Host writes are access checked with the manager's req (§7.8).
        if (changedPublished) await req.payload.update({ collection, id, req, overrideAccess: false, draft: false,
          data: contentData(published, field, publishedContent) })
        if (drafts) await req.payload.update({ collection, id, req, overrideAccess: false, draft: true,
          data: { ...contentData(draft, field, draftContent), _status: 'draft' } })
      })
    } else if (current.kind === 'flag') {
      const point = options.flagPoints?.find(point => point.id === current.flagPoint)
      if (!point) refuse('flag-no-point')
      if (point.makeContent) await attempt('xp-experiments', experimentId, () => point.makeContent!({ experimentId,
        winner: { arm: winner.key, params: winner.params ?? {} }, req }))
      // Lock the shared state before its read/modify/write, after L/F/E.
      await lockContentDefaults(exec)
      // §7.8 transition exception: durable made-content defaults in plugin state.
      const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: true, depth: 0 })
      // §7.8 transition exception: host documents above always use false.
      await req.payload.updateGlobal({ slug: 'xp-state', req, overrideAccess: true, data: { flagDefaults: {
        ...(state.flagDefaults as Record<string, unknown> ?? {}), [point.id]: { winnerArm: winner.key, params: winner.params ?? {},
          experiment: experimentId, decidedAt: current.decidedAt },
      } } })
    }
    const doc = await updateExperiment(req, experimentId, { decision: { ...decision, contentReport: { docs } } })
    if (docs.every(doc => doc.ok)) return { ...await archive(req, { experimentId, mode: 'after-content' }), docs }
    const manifest = await buildAndStoreManifest(req)
    return { doc, revision: manifest.revision, docs }
  })
  return result
}

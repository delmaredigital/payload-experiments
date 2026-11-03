import { Forbidden, NotFound, ValidationError, Locked, commitTransaction, initTransaction, killTransaction, type PayloadRequest, type Field } from 'payload'
import { safeError } from '../log.js'
import { XpRefusal } from '../errors.js'
import type { ContentReportReason } from '../types/reasons.js'
import { lockContentDefaults } from '../db/appends.js'
import { pooledExecutor, txExecutor } from '../db/executor.js'
import { currentTxid, txidStatus } from '../db/txid.js'
import { buildAndStoreManifest } from '../manifest/compile.js'
import { puckCollections } from '../options.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'
import { archive } from './archive.js'
import { relationshipId } from './checkStart.js'
import { withTransition } from './kernel.js'
import { scanBlockPlacements, type BlockPlacement } from './placements.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

type ContentDoc = { collection: string; id: DocId; ok: boolean; detail?: ContentReportReason; error?: ContentReportReason }

/** Classify by type/name only; host error messages can contain row data. */
function contentFailureReason(error: unknown): ContentReportReason {
  // Payload classes may use APIError as their name, so check instances too.
  const name = error instanceof Error ? error.name : undefined
  if (error instanceof Forbidden || name === 'Forbidden') return 'forbidden'
  if (error instanceof NotFound || name === 'NotFound') return 'not-found'
  if (error instanceof ValidationError || name === 'ValidationError') return 'validation'
  if (error instanceof Locked || name === 'Locked' || error instanceof XpRefusal && error.code === 'locked-placement') return 'locked'
  return 'update-failed'
}

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

/** Refuse unsafe collection shapes before rebuilding complete host documents. */
async function fieldRefusal(fields: Field[], req: PayloadRequest, doc: Record<string, unknown> & { id: DocId },
  operation: 'read' | 'update' = 'read', data: Record<string, unknown> = doc,
  siblingData: Record<string, unknown> = data, blockData?: Record<string, unknown>, seen = new Set<Field>()): Promise<string | undefined> {
  for (const field of fields) {
    if (seen.has(field)) continue
    const branch = new Set(seen).add(field)
    if ('localized' in field && field.localized) return 'This page is localized; update it by hand.'
    if ('hidden' in field && field.hidden === true) return 'This page has hidden fields; update it by hand.'
    if ('access' in field && field.access?.[operation] && !await field.access[operation]({ id: doc.id, req, doc, data, siblingData, blockData })) {
      return operation === 'read' ? 'This page has fields you cannot read; update it by hand.' : 'This page has fields you cannot update; update it by hand.'
    }
    const value = 'name' in field ? siblingData[field.name] : siblingData
    if ('tabs' in field) for (const tab of field.tabs) {
      if ('localized' in tab && tab.localized) return 'This page is localized; update it by hand.'
      if ('hidden' in tab && tab.hidden === true) return 'This page has hidden fields; update it by hand.'
      if ('access' in tab && tab.access?.[operation] && !await tab.access[operation]({ id: doc.id, req, doc, data, siblingData, blockData })) {
        return operation === 'read' ? 'This page has fields you cannot read; update it by hand.' : 'This page has fields you cannot update; update it by hand.'
      }
      const tabData = 'name' in tab && tab.name ? siblingData[tab.name] : siblingData
      const refusal = await fieldRefusal(tab.fields, req, doc, operation, data, object(tabData) ? tabData : {}, blockData, branch)
      if (refusal) return refusal
    }
    if ('fields' in field) for (const row of Array.isArray(value) && value.length ? value : [value]) {
      const refusal = await fieldRefusal(field.fields, req, doc, operation, data, object(row) ? row : {}, blockData, branch)
      if (refusal) return refusal
    }
    if (field.type === 'blocks') {
      const blocks = [...field.blocks, ...(field.blockReferences ?? []).map(slug => req.payload.config.blocks?.find(block => block.slug === slug)).filter(block => block !== undefined)]
      for (const block of blocks) {
        const rows = Array.isArray(value) ? value.filter(row => object(row) && row.blockType === block.slug) : []
        for (const row of rows.length ? rows : [{}]) {
          const refusal = await fieldRefusal(block.fields, req, doc, operation, data, row, row, branch)
          if (refusal) return refusal
        }
      }
    }
  }
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
        const detail = contentFailureReason(error)
        req.payload.logger.error({ err: safeError(error), experimentId, collection, id }, 'Experiment content update failed')
        docs.push({ collection, id, ok: false, detail, error: detail })
      }
    }
    if (current.kind === 'block') {
      if (!winner.slot) refuse('invalid-winner')
      const report = decision?.contentReport as { docs?: ContentDoc[] } | undefined
      const registrations = puckCollections(options)
      const scanned: BlockPlacement[] = []
      for (const registration of registrations) {
        const transactionID = req.transactionID
        delete req.transactionID
        try {
          scanned.push(...await scanBlockPlacements(req, { slug: current.slug, puckCollections: [registration] }))
        } catch (error) {
          // A collection made unreadable since the last attempt still has
          // retained placements to report below. Never sacrifice the outer tx.
          req.payload.logger.error({ err: safeError(error), experimentId, collection: registration.slug }, 'Experiment content scan failed')
          const denied = error && typeof error === 'object' && 'status' in error && error.status === 403
          if (!denied || !report?.docs?.some(doc => doc.collection === registration.slug)) throw error
        } finally { req.transactionID = transactionID }
      }
      if (scanned.some(doc => doc.locked)) refuse('locked-placement')
      const placements = new Map<string, { collection: string; id: DocId }>()
      for (const doc of [...(report?.docs ?? []), ...scanned]) placements.set(doc.collection + ':' + doc.id, doc)
      const skipped = new Set<string>()
      // Probe with no borrowed transaction: disableErrors handles expected
      // NotFound/Forbidden, and even a host read hook cannot kill the outer tx.
      for (const [key, { collection, id }] of placements) {
        const transactionID = req.transactionID
        delete req.transactionID
        try {
          const config = req.payload.config.collections.find(config => config.slug === collection)
          const access = config?.access?.read ? await config.access.read({ id, req }) : true
          const doc = await req.payload.findByID({ collection, id, req, overrideAccess: false, depth: 0, draft: true, includeLockStatus: true, disableErrors: true })
          if (!doc) {
            // Fail closed (exp-orch 16:20): only an unfiltered read proves the page is gone;
            // a Where-filtered miss may be a page this manager cannot see.
            const ok = access === true || (typeof access === 'object' && access !== null && Object.keys(access).length === 0)
            const detail: ContentReportReason = ok ? 'not-found' : 'forbidden'
            docs.push({ collection, id, ok, detail, ...(!ok ? { error: detail } : {}) })
            skipped.add(key)
          } else if (doc._isLocked === true || doc.locked === true) refuse('locked-placement', { collection, id })
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'locked-placement') throw error
          const missing = error && typeof error === 'object' && 'status' in error && error.status === 404
          req.payload.logger.error({ err: safeError(error), experimentId, collection, id }, 'Experiment content read failed')
          // A 404 means the placement is gone: nothing to update, so ok and detail must agree.
          const detail: ContentReportReason = missing ? 'not-found' : contentFailureReason(error)
          docs.push({ collection, id, ok: Boolean(missing), detail, ...(!missing ? { error: detail } : {}) })
          skipped.add(key)
        } finally { req.transactionID = transactionID }
      }
      for (const [key, { collection, id }] of placements) {
        if (skipped.has(key)) continue
        await attempt(collection, id, async () => {
          const field = registrations.find(entry => entry.slug === collection)?.field
          if (!field) throw new Error('This content collection is no longer configured.')
          const draft = await req.payload.findByID({ collection, id, req, overrideAccess: false, depth: 0, draft: true })
          const config = req.payload.config.collections.find(config => config.slug === collection)
          const drafts = Boolean(config?.versions && config.versions.drafts)
          const published = drafts ? await req.payload.findByID({ collection, id, req, overrideAccess: false, depth: 0, draft: false }) : draft
          const draftContent = unwrap(draft[field], current.slug, winner.slot!)
          const publishedContent = unwrap(published[field], current.slug, winner.slot!)
          const changedDraft = JSON.stringify(draftContent) !== JSON.stringify(draft[field])
          const changedPublished = JSON.stringify(publishedContent) !== JSON.stringify(published[field])
          // Nothing left to rewrite (e.g. an editor already did it by hand): done, before any refusal —
          // but only when the content field was really read (not stripped as hidden/unreadable, not localized).
          const contentField = topLevelField(config?.fields ?? [], field)
          // Payload strips hidden and read-denied fields from a read, so presence in both proves readability;
          // a localized content field compares only one locale, so it never takes the shortcut.
          const contentReadable = Object.hasOwn(draft, field) && Object.hasOwn(published, field) && !contentField?.localized
          if (contentReadable && !changedDraft && !changedPublished) return
          for (const doc of [draft, published]) {
            const refusal = await fieldRefusal(config?.fields ?? [], req, doc)
            if (refusal) throw new ValidationError({ errors: [{ message: refusal, path: field }] })
          }
          const publishedData = contentData(published, field, publishedContent)
          const draftData = { ...contentData(draft, field, draftContent), _status: 'draft' }
          // Payload beforeValidate receives the latest version as doc, and the
          // proposed write as data/siblingData (blockData is the proposed row).
          const publicationRefusal = await fieldRefusal(config?.fields ?? [], req, draft, 'update', publishedData)
          if (publicationRefusal) throw new ValidationError({ errors: [{ message: publicationRefusal, path: field }] })
          if (drafts) {
            const draftOriginal = changedPublished ? { ...published, ...publishedData } : draft
            const draftRefusal = await fieldRefusal(config?.fields ?? [], req, draftOriginal, 'update', draftData)
            if (draftRefusal) throw new ValidationError({ errors: [{ message: draftRefusal, path: field }] })
          }
          // Host writes are access checked with the manager's req (§7.8).
          if (changedPublished) await req.payload.update({ collection, id, req, overrideAccess: false, overrideLock: false, draft: false,
            data: publishedData })
          if (drafts) await req.payload.update({ collection, id, req, overrideAccess: false, overrideLock: false, draft: true,
            data: draftData })
        })
      }
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

/** The top-level data field with this name, looking through unnamed rows, collapsibles and tabs. */
function topLevelField(fields: readonly unknown[], name: string): { hidden?: boolean; localized?: boolean; access?: { read?: unknown } } | undefined {
  for (const raw of fields) {
    const field = raw as { name?: string; type?: string; fields?: unknown[]; tabs?: Array<{ name?: string; fields?: unknown[] }> }
    if (field.name === name) return field as never
    if (!field.name && (field.type === 'row' || field.type === 'collapsible') && field.fields) {
      const found = topLevelField(field.fields, name); if (found) return found
    }
    if (field.type === 'tabs') for (const tab of field.tabs ?? []) if (!tab.name && tab.fields) {
      const found = topLevelField(tab.fields, name); if (found) return found
    }
  }
  return undefined
}

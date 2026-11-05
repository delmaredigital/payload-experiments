import { Forbidden, NotFound, ValidationError, Locked, commitTransaction, initTransaction, killTransaction, type PayloadRequest, type Field, type Block } from 'payload'
import { latestDraftContent, publishedContent as readPublishedContent } from '../db/publishedContent.js'
import { EXPERIMENT_BLOCK_SLUG, hostBlocks, slotBlocks } from '../blocks/model.js'
import { findRegisteredBlocksField, freshBlockIds } from '../blocks/formState.js'
import { contentBlocks, hasLocalizedFields } from './contentFields.js'
import { safeError } from '../log.js'
import { XpRefusal } from '../errors.js'
import type { ContentReportReason } from '../types/reasons.js'
import { lockContentDefaults } from '../db/appends.js'
import { pooledExecutor, txExecutor } from '../db/executor.js'
import { currentTxid, txidStatus } from '../db/txid.js'
import { buildAndStoreManifest } from '../manifest/compile.js'
import { documentEditor, puckCollections } from '../options.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'
import { contentDone } from '../contentDone.js'
import { archive } from './archive.js'
import { relationshipId } from './checkStart.js'
import { withTransition } from './kernel.js'
import { scanBlockPlacements, type BlockPlacement } from './placements.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

type ContentDoc = { collection: string; id: DocId; ok: boolean; detail?: ContentReportReason; error?: ContentReportReason; dismissedAt?: string; dismissedBy?: string | null }

/** Classify by type/name only; host error messages can contain row data. */
function contentFailureReason(error: unknown): ContentReportReason {
  // Payload classes may use APIError as their name, so check instances too.
  const name = error instanceof Error ? error.name : undefined
  if (error instanceof LocalizedContent) return 'localized'
  if (error instanceof Forbidden || name === 'Forbidden') return 'forbidden'
  if (error instanceof NotFound || name === 'NotFound') return 'not-found'
  if (error instanceof ValidationError || name === 'ValidationError') return 'validation'
  if (error instanceof Locked || name === 'Locked' || error instanceof XpRefusal && error.code === 'locked-placement') return 'locked'
  return 'update-failed'
}

class LocalizedContent extends Error {}

const isNotFound = (error: unknown) => contentFailureReason(error) === 'not-found'
  || Boolean(error && typeof error === 'object' && 'status' in error && error.status === 404)

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
const contentMetadata = new Set(['id', 'createdAt', 'updatedAt', '_isLocked', '_userEditing'])

function contentData(doc: Record<string, unknown>, field: string, content: unknown, fields: Field[], blocks: Block[] = []): Record<string, unknown> {
  const data = { ...Object.fromEntries(Object.entries(doc).filter(([key]) => !contentMetadata.has(key))), [field]: content }
  return fillContentFields(fields, data, blocks)
}

/** Adapter reads can omit empty fields (notably single polymorphic links).
 * Make every stored value explicit so Payload cannot fill it from the other version.
 */
function fillContentFields(fields: Field[], source: Record<string, unknown>, blocks: Block[] = []): Record<string, unknown> {
  const result = { ...source }
  for (const field of fields) {
    if (field.type === 'ui' || field.type === 'join' || 'virtual' in field && field.virtual) continue
    const name = 'name' in field ? field.name : undefined
    if (name && contentMetadata.has(name)) continue
    if (name && result[name] === undefined) result[name] = field.type === 'array' || field.type === 'blocks' || 'hasMany' in field && field.hasMany ? [] : null
    if ('tabs' in field) for (const tab of field.tabs) {
      if ('name' in tab && tab.name) {
        const value = result[tab.name]
        // Payload traverses groups/tabs as objects; null would be dereferenced.
        result[tab.name] = fillContentFields(tab.fields, object(value) ? value : {}, blocks)
      } else Object.assign(result, fillContentFields(tab.fields, result, blocks))
    }
    const value = name ? result[name] : result
    if ('fields' in field) {
      if (Array.isArray(value)) result[name!] = value.map(row => object(row) ? fillContentFields(field.fields, row, blocks) : row)
      else if (object(value) || field.type === 'group') {
        const filled = fillContentFields(field.fields, object(value) ? value : {}, blocks)
        if (name) result[name] = filled
        else Object.assign(result, filled)
      }
    }
    if (field.type === 'blocks' && Array.isArray(value)) {
      const definitions = contentBlocks(field, blocks)
      result[name!] = value.map(row => {
        const block = object(row) ? definitions.find(block => block.slug === row.blockType) : undefined
        return block && object(row) ? fillContentFields(block.fields, row, blocks) : row
      })
    }
  }
  return result
}

/** Payload strips denied updates and fills them from the latest version. Only
 * refuse when that substitution would change the proposed value (KI-1).
 */
// Payload beforeChange/getExistingRowDoc.js matches array/block rows by ID.
const existingRow = (row: unknown, original: unknown): Record<string, unknown> => object(row) && row.id && Array.isArray(original)
  ? original.find(value => object(value) && value.id === row.id) ?? {} : {}

async function fieldRefusal(fields: Field[], req: PayloadRequest, doc: Record<string, unknown> & { id: DocId },
  operation: 'update' = 'update', data: Record<string, unknown> = doc,
  siblingData: Record<string, unknown> = data, blockData?: Record<string, unknown>, originalSibling: Record<string, unknown> = fillContentFields(fields, doc, req.payload.config.blocks)): Promise<string | undefined> {
  for (const field of fields) {
    if (field.type === 'ui' || field.type === 'join' || 'virtual' in field && field.virtual) continue
    if ('name' in field && !['id', 'createdAt', 'updatedAt'].includes(field.name) && JSON.stringify(siblingData[field.name] ?? null) !== JSON.stringify(originalSibling[field.name] ?? null) && 'access' in field && field.access?.[operation] && !await field.access[operation]({ id: doc.id, req, doc, data, siblingData, blockData })) {
      return 'This page has fields you cannot update; update it by hand.'
    }
    const value = 'name' in field ? siblingData[field.name] : siblingData
    if ('tabs' in field) for (const tab of field.tabs) {
      if ('name' in tab && tab.name && JSON.stringify(siblingData[tab.name] ?? null) !== JSON.stringify(originalSibling[tab.name] ?? null) && 'access' in tab && tab.access?.[operation] && !await tab.access[operation]({ id: doc.id, req, doc, data, siblingData, blockData })) {
        return 'This page has fields you cannot update; update it by hand.'
      }
      const tabData = 'name' in tab && tab.name ? siblingData[tab.name] : siblingData
      const originalTab = 'name' in tab && tab.name ? originalSibling[tab.name] : originalSibling
      const refusal = await fieldRefusal(tab.fields, req, doc, operation, data, object(tabData) ? tabData : {}, blockData, object(originalTab) ? originalTab : {})
      if (refusal) return refusal
    }
    const originalValue = 'name' in field ? originalSibling[field.name] : originalSibling
    if ('fields' in field) for (const row of Array.isArray(value) && value.length ? value : [value]) {
      const original = Array.isArray(value) ? existingRow(row, originalValue) : originalValue
      const refusal = await fieldRefusal(field.fields, req, doc, operation, data, object(row) ? row : {}, blockData, object(original) ? original : {})
      if (refusal) return refusal
    }
    if (field.type === 'blocks') {
      const blocks = contentBlocks(field, req.payload.config.blocks)
      for (const row of Array.isArray(value) ? value : []) {
        const block = object(row) ? blocks.find(block => block.slug === row.blockType) : undefined
        if (!block || !object(row)) continue
        const original = existingRow(row, originalValue)
        const refusal = await fieldRefusal(block.fields, req, doc, operation, data, row, row, object(original) ? original : {})
        if (refusal) return refusal
      }
    }
  }
}

/** Each placement commits independently while the outer transition retains its
 * experiment locks. Keep the manager's exact req/user, temporarily lending it a
 * fresh transaction; a denied host write must not kill the outer transaction.
 */
export async function hostTransaction(req: PayloadRequest, experimentId: DocId, fn: () => Promise<void>): Promise<void> {
  const transactionID = req.transactionID
  const transition = req.context.xpTransition
  const hadHeld = Object.hasOwn(req.context, 'xpHeldExperiments')
  const held = req.context.xpHeldExperiments
  req.context.xpHeldExperiments = [experimentId]
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
    if (hadHeld) req.context.xpHeldExperiments = held
    else delete req.context.xpHeldExperiments
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
    const report = decision?.contentReport as { docs?: ContentDoc[] } | undefined
    const previous = new Map((report?.docs ?? []).map(doc => [doc.collection + ':' + doc.id, doc]))
    const docs: ContentDoc[] = []
    // Dismissed failures are handled by the manager: retain them unchanged and
    // never retry them until restored. Each retried entry gets a fresh outcome.
    const retainDismissed = (collection: string, id: DocId) => {
      const entry = previous.get(collection + ':' + id)
      if (!entry?.dismissedAt) return false
      docs.push(entry)
      return true
    }
    const attempt = async (collection: string, id: DocId, fn: () => Promise<void>, missingOk = false) => {
      if (retainDismissed(collection, id)) return
      let missing = false
      try {
        await hostTransaction(req, experimentId, async () => {
          try { await fn() }
          catch (error) {
            if (missingOk && isNotFound(error)) {
              // Payload may already have killed the failed write's transaction.
              // Roll back any remaining writes, then check the row while still
              // detached from the outer transition and its privileged context.
              await killTransaction(req)
              if (!await initTransaction(req)) throw new Error('A content transaction could not be started.')
              missing = !await readPublishedContent(req, collection, id)
            }
            throw error
          }
        })
        docs.push({ collection, id, ok: true })
      }
      catch (error) {
        let detail: ContentReportReason
        if (isNotFound(error)) {
          if (missingOk) detail = 'forbidden'
          else detail = 'not-found'
        } else {
          detail = contentFailureReason(error)
        }
        req.payload.logger.error({ err: safeError(error), experimentId, collection, id }, 'Experiment content update failed')
        docs.push({ collection, id, ok: Boolean(missing), detail: missing ? 'not-found' : detail, ...(!missing ? { error: detail } : {}) })
      }
    }
    if (current.kind === 'block') {
      if (!winner.slot) refuse('invalid-winner')
      const registrations = [...puckCollections(options), ...options.blocks?.collections ?? []]
      const scanned: BlockPlacement[] = []
      for (const registration of registrations) {
        const transactionID = req.transactionID
        delete req.transactionID
        try {
          scanned.push(...await scanBlockPlacements(req, { slug: current.slug, puckCollections: puckCollections(options).filter(r => r === registration), blocksCollections: (options.blocks?.collections ?? []).filter(r => r === registration) }))
        } catch (error) {
          // A collection made unreadable since the last attempt still has
          // retained placements to report below. Never sacrifice the outer tx.
          req.payload.logger.error({ err: safeError(error), experimentId, collection: registration.slug }, 'Experiment content scan failed')
          const denied = error && typeof error === 'object' && 'status' in error && error.status === 403
          if (!denied || !report?.docs?.some(doc => doc.collection === registration.slug)) throw error
        } finally { req.transactionID = transactionID }
      }
      if (scanned.some(doc => doc.locked && !previous.get(doc.collection + ':' + doc.id)?.dismissedAt)) refuse('locked-placement')
      const placements = new Map<string, { collection: string; id: DocId }>()
      for (const doc of [...(report?.docs ?? []), ...scanned]) placements.set(doc.collection + ':' + doc.id, doc)
      const skipped = new Set<string>()
      // Probe with no borrowed transaction: disableErrors handles expected
      // NotFound/Forbidden, and even a host read hook cannot kill the outer tx.
      for (const [key, { collection, id }] of placements) {
        if (retainDismissed(collection, id)) { skipped.add(key); continue }
        const transactionID = req.transactionID
        delete req.transactionID
        try {
          const doc = await req.payload.findByID({ collection, id, req, overrideAccess: false, depth: 0, draft: true, includeLockStatus: true, disableErrors: true })
          // Null can also mean trashed or hidden by a host hook. Use the same
          // unfiltered existence check as a thrown NotFound before reporting done.
          if (!doc) throw new NotFound()
          if (doc._isLocked === true || doc.locked === true) refuse('locked-placement', { collection, id })
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'locked-placement') throw error
          let missing = false
          let detail: ContentReportReason = isNotFound(error) ? 'forbidden' : contentFailureReason(error)
          if (isNotFound(error)) {
            try {
              await hostTransaction(req, experimentId, async () => { missing = !await readPublishedContent(req, collection, id) })
            } catch (checkError) {
              missing = false
              detail = 'update-failed'
              req.payload.logger.error({ err: safeError(checkError), experimentId, collection, id }, 'Experiment content existence check failed')
            }
          }
          req.payload.logger.error({ err: safeError(error), experimentId, collection, id }, 'Experiment content read failed')
          docs.push({ collection, id, ok: Boolean(missing), detail: missing ? 'not-found' : detail, ...(!missing ? { error: detail } : {}) })
          skipped.add(key)
        } finally { req.transactionID = transactionID }
      }
      for (const [key, { collection, id }] of placements) {
        if (skipped.has(key)) continue
        await attempt(collection, id, async () => {
          let field = registrations.find(entry => entry.slug === collection)?.field
          if (!field) throw new Error('This content collection is no longer configured.')
          const config = req.payload.config.collections.find(config => config.slug === collection)
          if (hasLocalizedFields(config?.fields ?? [], req.payload.config)) throw new LocalizedContent()
          await req.payload.findByID({ collection, id, req, overrideAccess: false, depth: 0, draft: true })
          const drafts = Boolean(config?.versions && config.versions.drafts)
          const published = await readPublishedContent(req, collection, id)
          if (!published) throw new NotFound()
          const editor = documentEditor(options, collection, published)
          const blockRegistration = options.blocks?.collections.find(r => r.slug === collection)
          const contentField = editor === 'blocks' ? blockRegistration?.field : field
          if (!contentField) throw new Error('This content field is no longer configured.')
          field = contentField
          const transform = (value: unknown) => editor === 'blocks' ? !hostBlocks(value).some(block => block.blockType === (blockRegistration?.blockSlug ?? EXPERIMENT_BLOCK_SLUG) && block.experiment === current.slug) ? value : hostBlocks(value).flatMap(block => {
            if (block.blockType !== (blockRegistration?.blockSlug ?? EXPERIMENT_BLOCK_SLUG) || block.experiment !== current.slug) return [block]
            const rows = Array.isArray(block.slots) ? block.slots : []
            if (!rows.some(row => row?.slot === winner.slot)) throw new Error('The winning content slot is missing.')
            const registered = findRegisteredBlocksField(config?.fields ?? [], field!)
            if (!registered) throw new Error('This content field is no longer configured.')
            return slotBlocks(freshBlockIds([block], registered.field, req.payload.config)[0]!, winner.slot!)
          }) : unwrap(value, current.slug, winner.slot!)
          const draft = drafts ? await latestDraftContent(req, collection, id) ?? published : published
          const draftValue = draft[field] ?? null
          const draftContent = transform(draftValue)
          const publishedContent = transform(published[field])
          const changedDraft = JSON.stringify(draftContent) !== JSON.stringify(draftValue)
          const changedPublished = JSON.stringify(publishedContent) !== JSON.stringify(published[field])
          if (!changedDraft && !changedPublished) return
          const publishedData = contentData(published, field, publishedContent, config?.fields ?? [], req.payload.config.blocks)
          const draftData = { ...contentData(draft, field, draftContent, config?.fields ?? [], req.payload.config.blocks), _status: 'draft' }
          // Payload beforeValidate receives the latest version as doc, and the
          // proposed write as data/siblingData (blockData is the proposed row).
          if (changedPublished) {
            const publicationRefusal = await fieldRefusal(config?.fields ?? [], req, draft, 'update', publishedData)
            if (publicationRefusal) throw new ValidationError({ errors: [{ message: publicationRefusal, path: field }] })
          }
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
        }, true)
      }
    } else if (current.kind === 'flag') {
      const point = options.flagPoints?.find(point => point.id === current.flagPoint)
      if (!point) refuse('flag-no-point')
      if (point.makeContent) await attempt('xp-experiments', experimentId, () => point.makeContent!({ experimentId,
        winner: { arm: winner.key, params: winner.params ?? {} }, req }))
      else retainDismissed('xp-experiments', experimentId)
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
    if (contentDone({ docs })) return { ...await archive(req, { experimentId, mode: 'after-content' }), docs }
    const manifest = await buildAndStoreManifest(req)
    return { doc, revision: manifest.revision, docs }
  })
  return result
}

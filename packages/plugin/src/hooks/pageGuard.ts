import type { CollectionAfterChangeHook, CollectionAfterOperationHook, CollectionBeforeChangeHook, CollectionBeforeDeleteHook, CollectionBeforeOperationHook, PayloadRequest } from 'payload'
import { previousPublishedContent, storedContent } from '../db/appends.js'
import { lockPlacementScope, sortLockKeys } from '../db/locks.js'
import { txExecutor, pooledExecutor } from '../db/executor.js'
import { normalisePath } from '../runtime/normalisePath.js'
import { XpNoTransactionError, XpRefusal } from '../errors.js'
import { placementGuardCopy, pageGuardCopy, lastBlockPlacementCopy, READINESS_COPY } from '../testSurface/copy/readiness.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'

import { placementSlugs } from '../blocks/bindings.js'
import { isObject } from '../blocks/model.js'
import { placementTests, removableBlockTests, appendPlacementDoc, type PlacementTest } from '../db/placements.js'
import { hasOtherPublishedBlockPlacement } from '../transitions/placements.js'
import { isPageBusy } from '../db/pageBusy.js'

// beforeChange has no draft argument. Each operation owns a frame, including
// nested same-collection updates and restores on a reused Local API request.
type Operations = Map<string, Array<{ draft: boolean; restore: boolean }>>
// createLocalReq replaces context with a shallow copy on nested calls. Keep
// the shared stack in that context so both the outer req and its proxies see it.
const operations = (req: PayloadRequest) => req.context.xpPageGuardOperations as Operations | undefined
export const pageGuardBeforeOperation: CollectionBeforeOperationHook = ({ args, operation }) => {
  const req = args.req as PayloadRequest
  req.context.xpPlacementRemovals ??= { transaction: undefined, tests: new Map() }
  if (operation !== 'create' && operation !== 'update' && operation !== 'restoreVersion') return
  const call = args as { req: PayloadRequest; draft?: boolean; collection: { config: { slug: string } } }
  let collections = operations(call.req)
  if (!collections) call.req.context.xpPageGuardOperations = collections = new Map()
  const slug = call.collection.config.slug
  const stack = collections.get(slug) ?? []
  stack.push({ draft: call.draft === true, restore: operation === 'restoreVersion' })
  collections.set(slug, stack)
}
export const pageGuardAfterOperation: CollectionAfterOperationHook = ({ req, collection, operation, result }) => {
  // beforeOperation reports by-id updates as 'update'; afterOperation reports 'updateByID'.
  if (operation === 'create' || operation === 'update' || operation === 'updateByID' || operation === 'restoreVersion') {
    const collections = operations(req)
    const stack = collections?.get(collection.slug)
    stack?.pop()
    if (!stack?.length) collections?.delete(collection.slug)
  }
  return result
}

function optionsOf(req: PayloadRequest): ResolvedOptions {
  return req.payload.config.custom?.xp as ResolvedOptions
}
function registration(req: PayloadRequest, slug: string) {
  return optionsOf(req).pages?.collections.find(entry => entry.slug === slug)
}
const active = (test: PlacementTest) => test.status === 'running' || test.status === 'decided'
const pathsOf = (req: PayloadRequest, collection: string, rows: Array<Record<string, unknown> | undefined>): string[] => {
  const page = registration(req, collection)
  return page ? sortLockKeys(rows.flatMap(row => {
    const path = row ? page.pathOf(row) : null
    return path === null ? [] : [normalisePath(path)]
  })) : []
}
/** The later audit also recognises arm-select tags; include those ids in its lock superset. */
function taggedIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(v => taggedIds(v, ids))
  else if (isObject(value)) {
    if (typeof value.experiment === 'string' && typeof value.arm === 'string') ids.add(value.experiment)
    Object.values(value).forEach(v => taggedIds(v, ids))
  }
  return ids
}
export function guardExperimentIds(tests: readonly PlacementTest[], slugs: readonly string[], collection: string, paths: readonly string[], held: unknown, tags = new Set<string>(), discovered: readonly DocId[] = []): string[] {
  const excluded = new Set(Array.isArray(held) ? held.map(String) : [])
  const ids = tests.filter(test => slugs.includes(test.slug) || tags.has(String(test.id)) || test.kind === 'page'
    && (!test.pageCollection || test.pageCollection === collection) && test.arms.some(a => typeof a.pageTarget === 'string' && paths.includes(normalisePath(a.pageTarget))))
    .map(test => String(test.id))
  // A candidate may have committed after the broad audit discovery. Its indexed
  // removal lookup must still contribute E, including when it is not running yet.
  return sortLockKeys([...ids, ...discovered.map(String)].filter(id => !excluded.has(id)))
}
function protect(tests: readonly PlacementTest[], path: string): void {
  for (const test of tests) {
    if (test.kind !== 'page' || !active(test) && test.status !== 'archived') continue
    const archived = test.status === 'archived'
    if (archived && (!test.winnerArm || test.discardedAt || test.pagesReleasedAt)) continue
    if (!test.arms.length) throw new XpRefusal('invalid-phase', READINESS_COPY.missingVersions, { experimentId: test.id }, 409)
    const arms = archived ? test.arms.filter(a => a.kind === 'control' || a.key === test.winnerArm) : test.arms
    const matched = arms.find(a => typeof a.pageTarget === 'string' && normalisePath(a.pageTarget) === path)
    if (matched) throw new XpRefusal('locked-placement', pageGuardCopy(test.name, test.status as 'running' | 'decided' | 'archived', archived && matched.key !== test.winnerArm ? 'original' : 'winner'), { experimentId: test.id }, 409)
  }
}
function refuseInteraction(tests: readonly PlacementTest[], beforeSlugs: string[], afterSlugs: string[], beforePaths: string[], afterPaths: string[], collection: string): void {
  const blocks = tests.filter(test => test.kind === 'block' && active(test) && afterSlugs.includes(test.slug))
  const pages = tests.filter(test => test.kind === 'page' && active(test) && (!test.pageCollection || test.pageCollection === collection))
  for (const page of pages) {
    if (!page.arms.some(a => typeof a.pageTarget === 'string' && afterPaths.includes(normalisePath(a.pageTarget)))) continue
    const block = blocks[0]
    if (!block) continue
    const preExisting = beforeSlugs.includes(block.slug) && page.arms.some(a => typeof a.pageTarget === 'string' && beforePaths.includes(normalisePath(a.pageTarget)))
    throw new XpRefusal('interacting-tests', placementGuardCopy(page, block, preExisting), { experimentId: page.id, blockId: block.id }, 409)
  }
}
// Shared mutable state survives createLocalReq's shallow context copies. A transaction
// change resets the claims, so a reused Local API request cannot retain old removals.
type RemovalClaims = { transaction: unknown; tests: Map<string, Set<string>> }
const documentKey = (collection: string, id: DocId) => JSON.stringify([collection, String(id)])
async function removedBlockTests(req: PayloadRequest, beforeSlugs: string[], afterSlugs: string[]) {
  const removed = beforeSlugs.filter(slug => !afterSlugs.includes(slug))
  if (!removed.length) return []
  const exec = await req.transactionID != null ? txExecutor(req) : pooledExecutor(req.payload)
  return removableBlockTests(exec, removed)
}
async function claimRemovedBlocks(req: PayloadRequest, affected: Awaited<ReturnType<typeof removedBlockTests>>, collection: string, id: DocId): Promise<RemovalClaims | undefined> {
  if (!affected.length) return undefined
  const transaction = await req.transactionID
  if (transaction == null) throw new XpNoTransactionError('Save this page with transactions on.')
  let claims = req.context.xpPlacementRemovals as RemovalClaims | undefined
  if (!claims) req.context.xpPlacementRemovals = claims = { transaction, tests: new Map() }
  if (claims.transaction !== transaction) {
    claims.transaction = transaction
    claims.tests.clear()
  }
  // Claim every affected test before the first await of the search (including
  // the lock). Re-entrant advisory locks alone cannot serialize bulk siblings.
  for (const test of affected) {
    const key = String(test.id)
    const documents = claims.tests.get(key) ?? new Set<string>()
    documents.add(documentKey(collection, id))
    claims.tests.set(key, documents)
  }
  return claims
}
async function refuseRemovedBlocks(req: PayloadRequest, tests: readonly Pick<PlacementTest, 'id' | 'kind' | 'status'>[], affected: Awaited<ReturnType<typeof removedBlockTests>>, claims: RemovalClaims | undefined, removingPage: boolean): Promise<void> {
  if (!claims) return
  for (const test of affected) {
    // A draft/stopped test may have started while waiting for E. The existing
    // under-lock read is authoritative; Start rescans placements under the same E.
    if (!tests.some(current => String(current.id) === String(test.id) && current.status === 'running' && current.kind === 'block')) continue
    if (!await hasOtherPublishedBlockPlacement(req, optionsOf(req), test.slug,
      (collection, id) => claims.tests.get(String(test.id))!.has(documentKey(collection, id)))) {
      throw new XpRefusal('locked-placement', lastBlockPlacementCopy(test.name, removingPage), { experimentId: test.id }, 409)
    }
  }
}
function mapBusy(error: unknown): never {
  if (isPageBusy(error)) throw new XpRefusal('page-busy', 'This page is being updated by a test right now. Try again in a moment.', undefined, 409, { cause: error })
  throw error
}
export const pageGuardBeforeDelete: CollectionBeforeDeleteHook = async ({ req, id, collection }) => {
  try {
    // beforeDelete supplies no doc. One by-id discovery read also sees trashed rows.
    const published = await storedContent(req, collection.slug, id)
    if (!published || published._status === 'draft' || collection.trash && published.deletedAt != null) return
    const paths = pathsOf(req, collection.slug, [published])
    const exec = await req.transactionID != null ? txExecutor(req) : pooledExecutor(req.payload)
    const affected = await removedBlockTests(req, placementSlugs(optionsOf(req), collection.slug, published), [])
    const claims = await claimRemovedBlocks(req, affected, collection.slug, id)
    if (!registration(req, collection.slug)) {
      if (!affected.length) return
      // There is no pre-existing path/audit guard for delete on this collection.
      // Lock only removal candidates and recheck only their indexed slugs.
      await lockPlacementScope(exec, guardExperimentIds([], [], collection.slug, [], req.context.xpHeldExperiments, new Set(), affected.map(test => test.id)), [])
      const current = await removableBlockTests(exec, affected.map(test => test.slug))
      await refuseRemovedBlocks(req, current.map(test => ({ ...test, kind: 'block' })), affected, claims, true)
      return
    }
    let tests = await placementTests(exec)
    if (await req.transactionID != null) {
      await lockPlacementScope(exec, guardExperimentIds(tests, [...placementSlugs(optionsOf(req), collection.slug, published), ...affected.map(test => test.slug)], collection.slug, paths, req.context.xpHeldExperiments, taggedIds(published), affected.map(test => test.id)), paths)
      tests = await placementTests(exec)
    }
    await refuseRemovedBlocks(req, tests, affected, claims, true)
    for (const path of paths) protect(tests.filter(t => !t.pageCollection || t.pageCollection === collection.slug), path)
  } catch (error) { mapBusy(error) }
}

export const pageGuardBeforeChange: CollectionBeforeChangeHook = async ({ req, collection, originalDoc, operation, data }) => {
  const drafts = Boolean(collection.versions && collection.versions.drafts)
  const call = operations(req)?.get(collection.slug)?.at(-1)
  if (drafts && call?.draft && (call.restore || data._status !== 'published')) return data
  const after = operation === 'create' ? data : { ...originalDoc, ...data }
  const options = optionsOf(req)
  try {
    const published = operation === 'create' ? undefined : await previousPublishedContent(req, collection.slug, originalDoc.id as DocId)
    const before = published?._status === 'draft' || collection.trash && published?.deletedAt != null ? undefined : published
    const beforeSlugs = placementSlugs(options, collection.slug, before)
    const afterSlugs = placementSlugs(options, collection.slug, after)
    const beforePaths = pathsOf(req, collection.slug, [before]), afterPaths = pathsOf(req, collection.slug, [after])
    const paths = sortLockKeys([...beforePaths, ...afterPaths])
    const exec = await req.transactionID != null ? txExecutor(req) : pooledExecutor(req.payload)
    let tests = await placementTests(exec)
    const trashing = Boolean(collection.trash && after.deletedAt != null)
    const affected = await removedBlockTests(req, beforeSlugs, trashing || drafts && after._status !== 'published' ? [] : afterSlugs)
    const claims = await claimRemovedBlocks(req, affected, collection.slug, originalDoc?.id as DocId)
    const publishes = !drafts || after._status === 'published'
    if (await req.transactionID != null) {
      try {
        await lockPlacementScope(exec, guardExperimentIds(tests, [...beforeSlugs, ...afterSlugs, ...affected.map(test => test.slug)], collection.slug, paths, req.context.xpHeldExperiments, taggedIds([before, after]), affected.map(test => test.id)), paths)
        tests = await placementTests(exec)
      } catch (error) {
        if (!(error instanceof XpNoTransactionError) || affected.length) throw error
        // Only a session lost after discovery reaches this fallback. The first discovery
        // read and delete have no fallback: a dead session fails those operations closed.
        tests = await placementTests(pooledExecutor(req.payload))
      }
    }
    await refuseRemovedBlocks(req, tests, affected, claims, trashing || drafts && after._status !== 'published')
    if (operation === 'update' && before) {
      const page = registration(req, collection.slug)
      const old = page?.pathOf(before)
      const unpublishing = drafts && data._status === 'draft'
      const trashing = collection.trash && data.deletedAt != null && !originalDoc.deletedAt
      if (old != null && (unpublishing || trashing || page!.pathOf(after) !== old)) protect(tests.filter(t => !t.pageCollection || t.pageCollection === collection.slug), normalisePath(old))
    }
    if (publishes) refuseInteraction(tests, beforeSlugs, afterSlugs, beforePaths, afterPaths, collection.slug)
    return data
  } catch (error) { mapBusy(error) }
}

/** Unwrapped: these writes must fail the publish closed, unlike the best-effort audit. */
export const pageGuardAfterChange: CollectionAfterChangeHook = async ({ req, collection, doc }) => {
  const call = operations(req)?.get(collection.slug)?.at(-1)
  const drafts = Boolean(collection.versions && collection.versions.drafts)
  if (drafts && (doc._status !== 'published' || call?.draft && call.restore)) return doc
  if (await req.transactionID == null) return doc
  try {
    const stored = await storedContent(req, collection.slug, doc.id)
    if (!stored) throw new Error('The saved placement row was not found.')
    const slugs = placementSlugs(optionsOf(req), collection.slug, stored)
    // A later publish in this transaction can restore an earlier removal. Only
    // clear its claim once the stored published row actually contains the block.
    const claims = req.context.xpPlacementRemovals as RemovalClaims | undefined
    const exec = txExecutor(req)
    for (const test of await placementTests(exec)) {
      if (test.kind === 'block' && slugs.includes(test.slug)) {
        if (claims && claims.transaction === await req.transactionID && stored._status !== 'draft' && stored.deletedAt == null) {
          claims.tests.get(String(test.id))?.delete(documentKey(collection.slug, doc.id))
        }
        if (active(test)) await appendPlacementDoc(exec, test.id, test.phase, { collection: collection.slug, id: doc.id })
      }
    }
    return doc
  } catch (error) { mapBusy(error) }
}

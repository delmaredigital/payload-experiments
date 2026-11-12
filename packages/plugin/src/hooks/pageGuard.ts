import type { CollectionAfterChangeHook, CollectionAfterOperationHook, CollectionBeforeChangeHook, CollectionBeforeDeleteHook, CollectionBeforeOperationHook, PayloadRequest } from 'payload'
import { previousPublishedContent, storedContent } from '../db/appends.js'
import { lockPlacementScope, sortLockKeys } from '../db/locks.js'
import { txExecutor, pooledExecutor } from '../db/executor.js'
import { normalisePath } from '../runtime/normalisePath.js'
import { XpNoTransactionError, XpRefusal } from '../errors.js'
import { placementGuardCopy, pageGuardCopy, READINESS_COPY } from '../testSurface/copy/readiness.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'

import { placementSlugs } from '../blocks/bindings.js'
import { isObject } from '../blocks/model.js'
import { placementTests, removableBlockTests, appendPlacementDoc, type PlacementTest } from '../db/placements.js'
import { isPageBusy } from '../db/pageBusy.js'
import { blockRemovalRule, releaseRemovalClaim, observeUnpublishedRemoval, releaseRestoredRemovalClaims, type RemovalClaims } from './blockRemovalRule.js'
import { removedPlacementViews } from '../blocks/placementLocale.js'

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
  // Bulk Local API errors are returned per document, without invoking afterError.
  if (result && typeof result === 'object' && 'errors' in result && Array.isArray(result.errors)) {
    for (const error of result.errors) if (error && error.id != null) releaseRemovalClaim(req, collection.slug, error.id)
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
function mapBusy(error: unknown): never {
  if (isPageBusy(error)) throw new XpRefusal('page-busy', 'This page is being updated by a test right now. Try again in a moment.', undefined, 409, { cause: error })
  throw error
}
export const pageGuardBeforeDelete: CollectionBeforeDeleteHook = async ({ req, id, collection }) => {
  try {
    const page = registration(req, collection.slug)
    // Keep the earlier page guard's baseline read and every refusal intact.
    const published = page ? await previousPublishedContent(req, collection.slug, id) : await storedContent(req, collection.slug, id)
    if (!published || published._status === 'draft') return
    const paths = pathsOf(req, collection.slug, [published])
    const exec = await req.transactionID != null ? txExecutor(req) : pooledExecutor(req.payload)
    let tests = page ? await placementTests(exec) : undefined
    const views = removedPlacementViews(req, collection.slug, collection.trash && published.deletedAt != null ? undefined : published, {}, true)
    const affected = views.size ? await blockRemovalRule.discover(exec, [...views.keys()], tests) : []
    if (!page) {
      if (!affected.length) return
      if (await req.transactionID != null) {
        await lockPlacementScope(exec, guardExperimentIds([], [], collection.slug, [], req.context.xpHeldExperiments, new Set(), affected.map(test => test.id)), [])
        tests = (await removableBlockTests(exec, affected.map(test => test.slug))).map(test => ({ ...test, kind: 'block' } as PlacementTest))
      } else tests = affected
    } else if (await req.transactionID != null) {
      await lockPlacementScope(exec, guardExperimentIds(tests!, placementSlugs(optionsOf(req), collection.slug, published), collection.slug, paths, req.context.xpHeldExperiments, taggedIds(published), affected.map(test => test.id)), paths)
      tests = await placementTests(exec)
    }
    for (const path of paths) protect(tests!.filter(t => !t.pageCollection || t.pageCollection === collection.slug), path)
    if (affected.length) await blockRemovalRule.check(req, tests!, affected, collection.slug, id, true, views)
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
    const before = published?._status === 'draft' ? undefined : published
    const beforeSlugs = placementSlugs(options, collection.slug, before)
    const afterSlugs = placementSlugs(options, collection.slug, after)
    const beforePaths = pathsOf(req, collection.slug, [before]), afterPaths = pathsOf(req, collection.slug, [after])
    const paths = sortLockKeys([...beforePaths, ...afterPaths])
    const exec = await req.transactionID != null ? txExecutor(req) : pooledExecutor(req.payload)
    let tests = await placementTests(exec)
    const trashing = Boolean(collection.trash && after.deletedAt != null)
    const views = removedPlacementViews(req, collection.slug, collection.trash && before?.deletedAt != null ? undefined : before, after, trashing || drafts && after._status !== 'published')
    const affected = views.size ? await blockRemovalRule.discover(exec, [...views.keys()], tests) : []
    const publishes = !drafts || after._status === 'published'
    const noTransaction = () => {
      if (publishes && tests.some(t => t.kind === 'block' && active(t) && afterSlugs.includes(t.slug))) throw new XpNoTransactionError('Save this page with transactions on.')
    }
    if (await req.transactionID == null) noTransaction()
    else {
      try {
        await lockPlacementScope(exec, guardExperimentIds(tests, [...beforeSlugs, ...afterSlugs], collection.slug, paths, req.context.xpHeldExperiments, taggedIds([before, after]), affected.map(test => test.id)), paths)
        tests = await placementTests(exec)
      } catch (error) {
        if (!(error instanceof XpNoTransactionError)) throw error
        // Only a session lost after discovery reaches this fallback. The first discovery
        // read and delete have no fallback: a dead session fails those operations closed.
        tests = await placementTests(pooledExecutor(req.payload))
        noTransaction()
      }
    }
    if (operation === 'update' && before) {
      const page = registration(req, collection.slug)
      const old = page?.pathOf(before)
      const unpublishing = drafts && data._status === 'draft'
      const trashing = collection.trash && data.deletedAt != null && !originalDoc.deletedAt
      if (old != null && (unpublishing || trashing || page!.pathOf(after) !== old)) protect(tests.filter(t => !t.pageCollection || t.pageCollection === collection.slug), normalisePath(old))
    }
    if (publishes) refuseInteraction(tests, beforeSlugs, afterSlugs, beforePaths, afterPaths, collection.slug)
    if (affected.length) await blockRemovalRule.check(req, tests, affected, collection.slug, originalDoc.id as DocId, trashing || drafts && after._status !== 'published', views)
    return data
  } catch (error) { mapBusy(error) }
}

/** Unwrapped: these writes must fail the publish closed, unlike the best-effort audit. */
export const pageGuardAfterChange: CollectionAfterChangeHook = async ({ req, collection, doc }) => {
  const call = operations(req)?.get(collection.slug)?.at(-1)
  const drafts = Boolean(collection.versions && collection.versions.drafts)
  if (!call?.draft && (drafts && doc._status !== 'published' || collection.trash && doc.deletedAt != null)) observeUnpublishedRemoval(req, collection.slug, doc.id)
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
      if (test.kind === 'block' && active(test) && slugs.includes(test.slug)) await appendPlacementDoc(exec, test.id, test.phase, { collection: collection.slug, id: doc.id })
      if (test.kind === 'block' && claims && claims.transaction === await req.transactionID && stored._status !== 'draft' && stored.deletedAt == null) {
        releaseRestoredRemovalClaims(req, collection.slug, stored as Record<string, unknown> & { id: DocId }, test)
      }
    }
    return doc
  } catch (error) { mapBusy(error) }
}

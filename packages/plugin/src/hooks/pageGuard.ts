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
import { placementTests, appendPlacementDoc, type PlacementTest } from '../db/placements.js'
import { scanBlockPlacements, type PlacementChange } from '../transitions/placements.js'
import { isPageBusy } from '../db/pageBusy.js'

// beforeChange has no draft argument. Each operation owns a frame, including
// nested same-collection updates and restores on a reused Local API request.
type Operations = Map<string, Array<{ draft: boolean; restore: boolean }>>
// createLocalReq replaces context with a shallow copy on nested calls. Keep
// the shared stack in that context so both the outer req and its proxies see it.
const operations = (req: PayloadRequest) => req.context.xpPageGuardOperations as Operations | undefined
export const pageGuardBeforeOperation: CollectionBeforeOperationHook = ({ args, operation }) => {
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
export function guardExperimentIds(tests: readonly PlacementTest[], slugs: readonly string[], collection: string, paths: readonly string[], held: unknown, tags = new Set<string>()): string[] {
  const excluded = new Set(Array.isArray(held) ? held.map(String) : [])
  return sortLockKeys(tests.filter(test => slugs.includes(test.slug) || tags.has(String(test.id)) || test.kind === 'page'
    && (!test.pageCollection || test.pageCollection === collection) && test.arms.some(a => typeof a.pageTarget === 'string' && paths.includes(normalisePath(a.pageTarget))))
    .map(test => String(test.id)).filter(id => !excluded.has(id)))
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
async function blockTestsOnDocument(req: PayloadRequest, tests: readonly PlacementTest[], collection: string, id: DocId): Promise<PlacementTest[]> {
  const blocks = tests.filter(test => test.kind === 'block')
  if (!blocks.length) return []
  const options = optionsOf(req)
  const placements = await scanBlockPlacements(req, { slugs: new Set(blocks.map(test => test.slug)),
    puckCollections: options.puck?.collections ?? [], blocksCollections: options.blocks?.collections ?? [], pageGuard: true })
  return blocks.filter(test => placements.get(test.slug)?.some(p => p.collection === collection && String(p.id) === String(id)))
}
async function refuseRemovedBlocks(req: PayloadRequest, tests: readonly PlacementTest[], affected: readonly PlacementTest[], change: PlacementChange): Promise<void> {
  const running = tests.filter(test => test.kind === 'block' && test.status === 'running' && affected.some(old => String(old.id) === String(test.id)))
  if (!running.length) return
  if (await req.transactionID == null) throw new XpNoTransactionError('Save this page with transactions on.')
  const options = optionsOf(req)
  const placements = await scanBlockPlacements(req, { slugs: new Set(running.map(test => test.slug)), change,
    puckCollections: options.puck?.collections ?? [], blocksCollections: options.blocks?.collections ?? [], pageGuard: true })
  for (const test of running) if (!placements.get(test.slug)?.length) {
    throw new XpRefusal('locked-placement', lastBlockPlacementCopy(test.name), { experimentId: test.id }, 409)
  }
}
function mapBusy(error: unknown): never {
  if (isPageBusy(error)) throw new XpRefusal('page-busy', 'This page is being updated by a test right now. Try again in a moment.', undefined, 409, { cause: error })
  throw error
}
export const pageGuardBeforeDelete: CollectionBeforeDeleteHook = async ({ req, id, collection }) => {
  try {
    const published = await previousPublishedContent(req, collection.slug, id)
    const paths = pathsOf(req, collection.slug, [published?._status === 'draft' ? undefined : published])
    const exec = await req.transactionID != null ? txExecutor(req) : pooledExecutor(req.payload)
    let tests = await placementTests(exec)
    const affected = await blockTestsOnDocument(req, tests, collection.slug, id)
    if (await req.transactionID != null) {
      await lockPlacementScope(exec, guardExperimentIds(tests, [...placementSlugs(optionsOf(req), collection.slug, published), ...affected.map(test => test.slug)], collection.slug, paths, req.context.xpHeldExperiments, taggedIds(published)), paths)
      tests = await placementTests(exec)
    }
    await refuseRemovedBlocks(req, tests, affected, { collection: collection.slug, id })
    for (const path of paths) protect(tests.filter(t => !t.pageCollection || t.pageCollection === collection.slug), path)
  } catch (error) { mapBusy(error) }
}

export const pageGuardBeforeChange: CollectionBeforeChangeHook = async ({ req, collection, originalDoc, operation, data }) => {
  const drafts = Boolean(collection.versions && collection.versions.drafts)
  const call = operations(req)?.get(collection.slug)?.at(-1)
  const draftOnly = drafts && call?.draft === true && (call.restore || data._status !== 'published')
  if (draftOnly) {
    try {
      const exec = await req.transactionID != null ? txExecutor(req) : pooledExecutor(req.payload)
      let tests = await placementTests(exec)
      const affected = operation === 'create' ? [] : await blockTestsOnDocument(req, tests, collection.slug, originalDoc.id as DocId)
      if (await req.transactionID != null && affected.length) {
        await lockPlacementScope(exec, guardExperimentIds(tests, affected.map(test => test.slug), collection.slug, [], req.context.xpHeldExperiments), [])
        tests = await placementTests(exec)
      }
      await refuseRemovedBlocks(req, tests, affected, { collection: collection.slug, id: originalDoc?.id as DocId, draftOnly: true, doc: { ...originalDoc, ...data } })
      return data
    } catch (error) { mapBusy(error) }
  }
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
    const affected = operation === 'create' ? [] : await blockTestsOnDocument(req, tests, collection.slug, originalDoc.id as DocId)
    const publishes = !drafts || after._status === 'published'
    const noTransaction = () => {
      if (publishes && tests.some(t => t.kind === 'block' && active(t) && afterSlugs.includes(t.slug))) throw new XpNoTransactionError('Save this page with transactions on.')
    }
    if (await req.transactionID == null) noTransaction()
    else {
      try {
        await lockPlacementScope(exec, guardExperimentIds(tests, [...beforeSlugs, ...afterSlugs, ...affected.map(test => test.slug)], collection.slug, paths, req.context.xpHeldExperiments, taggedIds([before, after])), paths)
        tests = await placementTests(exec)
      } catch (error) {
        if (!(error instanceof XpNoTransactionError)) throw error
        // Only a session lost after discovery reaches this fallback. The first discovery
        // read and delete have no fallback: a dead session fails those operations closed.
        tests = await placementTests(pooledExecutor(req.payload))
        noTransaction()
      }
    }
    const trashing = collection.trash && after.deletedAt != null
    await refuseRemovedBlocks(req, tests, affected, { collection: collection.slug, id: originalDoc?.id as DocId, ...(trashing ? {} : { doc: after }) })
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
    const exec = txExecutor(req)
    for (const test of await placementTests(exec)) {
      if (test.kind === 'block' && active(test) && slugs.includes(test.slug)) await appendPlacementDoc(exec, test.id, test.phase, { collection: collection.slug, id: doc.id })
    }
    return doc
  } catch (error) { mapBusy(error) }
}

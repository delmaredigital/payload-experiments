import type { PayloadRequest } from 'payload'
import type { Executor } from '../db/executor.js'
import { removableBlockTests, type PlacementTest } from '../db/placements.js'
import { XpNoTransactionError, XpRefusal } from '../errors.js'
import { lastBlockPlacementCopy, pendingBlockRemovalCopy, bulkBlockRemovalCopy } from '../testSurface/copy/readiness.js'
import { hasOtherPublishedBlockPlacement } from '../transitions/placements.js'
import { bulkRemoves, type BulkPlacementRemoval } from '../db/bulkPlacementRemoval.js'
import { localeRequest, placementLocaleContent, removedPlacementViews, placementDocumentKey, type RemovedPlacementViews, type PlacementLocaleView } from '../blocks/placementLocale.js'
import { placementSlugs } from '../blocks/bindings.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'

// Mutable state survives createLocalReq's shallow context copy. Claims are scoped
// to one transaction; a later transaction on the same request starts empty.
export type RemovalClaims = { transaction: unknown; tests: Map<string, Set<string>>; counts?: Map<string, Map<string, number>>; absent?: Set<string> }
export function releaseRemovalClaim(req: PayloadRequest, collection: string, id: DocId, ownKeys?: Map<string, Set<string>>): void {
  const claims = req.context.xpPlacementRemovals as RemovalClaims | undefined
  for (const [test, documents] of claims?.tests ?? []) for (const key of documents) {
    const [slug, docId] = JSON.parse(key) as [string, string]
    if (slug !== collection || docId !== String(id) || ownKeys && !ownKeys.get(test)?.has(key)) continue
    const count = claims?.counts?.get(test)?.get(key) ?? 1
    if (ownKeys && count > 1) claims!.counts!.get(test)!.set(key, count - 1)
    else {
      documents.delete(`${key}`)
      claims?.counts?.get(test)?.delete(`${key}`)
      claims?.absent?.delete(`${test}:${key}`)
    }
  }
}

/** A removal must have reached afterChange before a later write can restore it.
 * A write merely retaining another locale cannot clear an in-flight removal.
 */
export function observeUnpublishedRemoval(req: PayloadRequest, collection: string, id: DocId): void {
  const claims = req.context.xpPlacementRemovals as RemovalClaims | undefined
  if (!claims) return
  claims.absent ??= new Set()
  for (const [test, documents] of claims.tests) for (const key of documents) {
    const [slug, docId] = JSON.parse(key) as [string, string]
    if (slug === collection && docId === String(id)) claims.absent.add(`${test}:${key}`)
  }
}
export function releaseRestoredRemovalClaims(req: PayloadRequest, collection: string, doc: Record<string, unknown> & { id: DocId }, test: PlacementTest): void {
  const claims = req.context.xpPlacementRemovals as RemovalClaims | undefined
  if (!claims) return
  claims.absent ??= new Set()
  for (const key of claims.tests.get(String(test.id)) ?? []) {
    const [slug, id, view] = JSON.parse(key) as [string, string, PlacementLocaleView]
    if (slug !== collection || id !== String(doc.id)) continue
    const marker = `${test.id}:${key}`
    if (!placementSlugs(req.payload.config.custom!.xp as ResolvedOptions, collection,
      placementLocaleContent(localeRequest(req, view), collection, doc)).includes(test.slug)) claims.absent.add(marker)
    else if (claims.absent.has(marker) && (claims.counts?.get(String(test.id))?.get(key) ?? 1) === 1) {
      claims.tests.get(String(test.id))!.delete(`${key}`)
      claims.counts?.get(String(test.id))?.delete(`${key}`)
      claims.absent.delete(`${marker}`)
    }
  }
}

// Separate removal-rule entry points let tests observe its IO independently
// of the earlier page-path and publish guards.
export const blockRemovalRule = {
  async prepare(req: PayloadRequest, collection: string, before: Record<string, unknown> | undefined, after: Record<string, unknown>, removingPage: boolean, exec?: Executor, tests?: readonly PlacementTest[]) {
    const views = removedPlacementViews(req, collection, before, after, removingPage)
    const affected = views.size ? await blockRemovalRule.discover(exec!, [...views.keys()], tests) : []
    return { views, affected }
  },
  async discover(exec: Executor, removed: string[], tests?: readonly PlacementTest[]): Promise<PlacementTest[]> {
    if (tests) return tests.filter(test => test.kind === 'block' && ['draft', 'stopped', 'running'].includes(test.status) && removed.includes(test.slug))
    return (await removableBlockTests(exec, removed)).map(test => ({ ...test, kind: 'block', pageCollection: null, phase: 0, arms: [], placementDocs: null }))
  },
  claim(req: PayloadRequest, transaction: unknown, affected: readonly PlacementTest[], collection: string, id: DocId, views: RemovedPlacementViews): RemovalClaims {
    let claims = req.context.xpPlacementRemovals as RemovalClaims | undefined
    if (!claims) req.context.xpPlacementRemovals = claims = { transaction, tests: new Map() }
    claims.counts ??= new Map()
    claims.absent ??= new Set()
    if (claims.transaction !== transaction) { claims.transaction = transaction; claims.tests.clear(); claims.counts.clear(); claims.absent.clear() }
    for (const test of affected) {
      const documents = claims.tests.get(String(test.id)) ?? new Set<string>()
      const counts = claims.counts.get(String(test.id)) ?? new Map<string, number>()
      for (const view of views.get(test.slug) ?? []) {
        const key = placementDocumentKey(collection, id, view)
        documents.add(key)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      claims.tests.set(String(test.id), documents)
      claims.counts.set(String(test.id), counts)
    }
    return claims
  },
  async check(req: PayloadRequest, current: readonly PlacementTest[], affected: readonly PlacementTest[], collection: string, id: DocId, removingPage: boolean, views: RemovedPlacementViews, bulk?: BulkPlacementRemoval): Promise<void> {
    const transaction = await req.transactionID
    // Claim only after every earlier guard passed. These claims cover subsequent
    // writes; the complete bulk selection covers siblings before any can decide.
    const claims = transaction == null ? undefined : blockRemovalRule.claim(req, transaction, affected, collection, id, views)
    const ownKeys = new Map(affected.map(test => [String(test.id), new Set((views.get(test.slug) ?? []).map(view => placementDocumentKey(collection, id, view)))]))
    try {
      for (const test of affected) {
        if (!current.some(row => String(row.id) === String(test.id) && row.kind === 'block' && row.status === 'running')) continue
        const documents = claims?.tests.get(String(test.id))
        let excludedSibling = false
        if (await hasOtherPublishedBlockPlacement(req, req.payload.config.custom!.xp as ResolvedOptions, test.slug,
          (slug, docId, view, doc) => {
            const key = placementDocumentKey(slug, docId, view)
            if (ownKeys.get(String(test.id))?.has(key)) return true
            if (bulkRemoves(bulk, req, slug, doc, test.slug, view) || documents?.has(key)) { excludedSibling = true; return true }
            return false
          })) continue
        if (transaction == null) throw new XpNoTransactionError('Save this page with transactions on.')
        // Bulk selection is immutable through every sibling's decision, including
        // earlier rule refusals. afterOperation explains unrelated failed writes.
        const message = excludedSibling ? bulk ? bulkBlockRemovalCopy(test.name) : pendingBlockRemovalCopy(test.name) : lastBlockPlacementCopy(test.name, removingPage)
        if (bulk && excludedSibling) bulk.refusals.set(message, pendingBlockRemovalCopy(test.name))
        throw new XpRefusal('locked-placement', message, { experimentId: test.id }, 409)
      }
    } catch (error) {
      releaseRemovalClaim(req, collection, id, ownKeys)
      throw error
    }
  },
}

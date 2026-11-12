import type { PayloadRequest } from 'payload'
import type { Executor } from '../db/executor.js'
import { removableBlockTests, type PlacementTest } from '../db/placements.js'
import { XpNoTransactionError, XpRefusal } from '../errors.js'
import { lastBlockPlacementCopy, pendingBlockRemovalCopy } from '../testSurface/copy/readiness.js'
import { hasOtherPublishedBlockPlacement } from '../transitions/placements.js'
import { localeRequest, placementLocaleContent, type RemovedPlacementViews, type PlacementLocaleView } from '../blocks/placementLocale.js'
import { placementSlugs } from '../blocks/bindings.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'

// Mutable state survives createLocalReq's shallow context copy. Claims are scoped
// to one transaction; a later transaction on the same request starts empty.
export type RemovalClaims = { transaction: unknown; tests: Map<string, Set<string>>; counts?: Map<string, Map<string, number>>; absent?: Set<string> }
const documentKey = (collection: string, id: DocId, view: PlacementLocaleView) => JSON.stringify([collection, String(id), view])
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

// Object entry points make the rule independently observable and disableable in
// the baseline comparison tests, without stubbing the pre-existing guard.
export const blockRemovalRule = {
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
        const key = documentKey(collection, id, view)
        documents.add(key)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      claims.tests.set(String(test.id), documents)
      claims.counts.set(String(test.id), counts)
    }
    return claims
  },
  async check(req: PayloadRequest, current: readonly PlacementTest[], affected: readonly PlacementTest[], collection: string, id: DocId, removingPage: boolean, views: RemovedPlacementViews): Promise<void> {
    const transaction = await req.transactionID
    // Claim only after every earlier guard passed. No await between claiming all
    // affected tests and starting the scan: bulk siblings must see each other.
    const claims = transaction == null ? undefined : blockRemovalRule.claim(req, transaction, affected, collection, id, views)
    const ownKeys = new Map(affected.map(test => [String(test.id), new Set((views.get(test.slug) ?? []).map(view => documentKey(collection, id, view)))]))
    try {
      for (const test of affected) {
        if (!current.some(row => String(row.id) === String(test.id) && row.kind === 'block' && row.status === 'running')) continue
        const documents = claims?.tests.get(String(test.id))
        for (const view of views.get(test.slug) ?? []) {
          let excludedSibling = false
          if (await hasOtherPublishedBlockPlacement(localeRequest(req, view), req.payload.config.custom!.xp as ResolvedOptions, test.slug,
            (slug, docId) => {
              const key = documentKey(slug, docId, view)
              if (key === documentKey(collection, id, view)) return true
              if (documents?.has(key)) { excludedSibling = true; return true }
              return false
            })) continue
          if (transaction == null) throw new XpNoTransactionError('Save this page with transactions on.')
          // Remember what the scan excluded, even if that sibling fails and clears
          // its claim before this await resumes. Never assert that row is absent.
          let message = excludedSibling ? pendingBlockRemovalCopy(test.name) : lastBlockPlacementCopy(test.name, removingPage)
          if (!excludedSibling && req.payload.config.localization) message = message.replace('published place it appears', `published place it appears in this language (${view.locale})`)
          throw new XpRefusal('locked-placement', message, { experimentId: test.id }, 409)
        }
      }
    } catch (error) {
      releaseRemovalClaim(req, collection, id, ownKeys)
      throw error
    }
  },
}

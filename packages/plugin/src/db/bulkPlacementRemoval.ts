import type { PayloadRequest, Where } from 'payload'
import { removedPlacementViews, placementDocumentKey, type PlacementLocaleView } from '../blocks/placementLocale.js'
import type { DocId } from '../types/contracts.js'

export interface BulkPlacementRemoval {
  documents: Set<string>
  change?: { collection: string; data?: Record<string, unknown>; draft: boolean; deleting: boolean }
  refusals: Map<string, string>
}

/** A distinct operation identity without copying the transaction/context. Native
 * Request accessors and methods must use the original receiver.
 */
export function placementOperationRequest(req: PayloadRequest, fields: Map<PropertyKey, unknown>, failed?: () => void): PayloadRequest {
  return new Proxy(req, { deleteProperty(target, key) {
    // Payload killTransaction.js:12 deletes this property on operation failure.
    if (key === 'transactionID') failed?.()
    return Reflect.deleteProperty(target, key)
  }, get(target, key) {
    if (fields.has(key)) return fields.get(key)
    const value = Reflect.get(target, key, target)
    return typeof Object.getOwnPropertyDescriptor(Request.prototype, key)?.value === 'function' ? value.bind(target) : value
  } })
}

/** Observe Payload's actual, access-filtered bulk selection before it dispatches
 * any document hooks. This request-only proxy adds no reads and never replaces
 * the shared adapter. Matching the original Where node avoids capturing nested
 * access-hook reads. queryDrafts prefixes keys but preserves condition objects.
 * Payload 3's update/delete operations select the entire set before Promise.all.
 */
export function bulkPlacementRequest(req: PayloadRequest, collection: string, where: Where,
  data: Record<string, unknown> | undefined, draft: boolean, deleting: boolean, bulk: BulkPlacementRemoval): PayloadRequest {
  const config = req.payload.config.collections.find(entry => entry.slug === collection)
  const draftOnly = draft && Boolean(config?.versions && config.versions.drafts) && data?._status !== 'published'
  bulk.change = { collection, data, draft: draftOnly, deleting }
  let captured = false
  const matches = (value: unknown, expected: unknown, versions: boolean): boolean => {
    if (value === expected) return true
    if (!versions) return false
    if (!value || !expected || typeof value !== 'object' || typeof expected !== 'object') return false
    const actual = value as Record<string, unknown>
    return Object.entries(expected).every(([key, condition]) => {
      if (key === 'and' || key === 'or') return Array.isArray(actual[key]) && Array.isArray(condition)
        && condition.length === (actual[key] as unknown[]).length
        && condition.every((entry, i) => matches((actual[key] as unknown[])[i], entry, versions))
      return actual[versions ? key === 'id' ? 'parent' : `version.${key}` : key] === condition
    }) && Object.keys(actual).length === Object.keys(expected).length
  }
  const contains = (value: unknown, versions: boolean): boolean => matches(value, where, versions)
    || !!value && typeof value === 'object' && ['and', 'or'].some(key => {
      const children = (value as Record<string, unknown>)[key]
      return Array.isArray(children) && children.some(child => contains(child, versions))
    })
  const database = new Proxy(req.payload.db, {
    get(target, key, receiver) {
      const method = Reflect.get(target, key, receiver)
      if (key !== 'find' && key !== 'queryDrafts') return method
      return async (query: { collection: string; req?: PayloadRequest; where?: Where }) => {
        const selection = !captured && (key !== 'queryDrafts' || 'pagination' in query && query.pagination === false) && query.req === scoped && query.collection === collection && contains(query.where, key === 'queryDrafts')
        const result = await method.call(target, query)
        if (selection) {
          captured = true
          for (const doc of result.docs as Array<{ id: DocId }>) bulk.documents.add(JSON.stringify([collection, String(doc.id)]))
        }
        return result
      }
    },
  })
  const payload = new Proxy(req.payload, { get: (target, key, receiver) => key === 'db' ? database : Reflect.get(target, key, receiver) })
  const scoped = placementOperationRequest(req, new Map<PropertyKey, unknown>([['payload', payload]]))
  return scoped
}

/** Evaluate the common change against the published row seen under E, rather
 * than a draft version or a selection snapshot from before the lock. */
export function bulkRemoves(bulk: BulkPlacementRemoval | undefined, req: PayloadRequest, collection: string,
  doc: Record<string, unknown> & { id: DocId }, slug: string, view: PlacementLocaleView): boolean {
  const change = bulk?.change
  if (!change || change.draft || change.collection !== collection || !bulk!.documents.has(JSON.stringify([collection, String(doc.id)]))) return false
  const after = { ...doc, ...change.data }
  const views = removedPlacementViews(req, collection, doc, after, change.deleting || after.deletedAt != null || after._status === 'draft')
  return (views.get(slug) ?? []).some(removed => placementDocumentKey(collection, doc.id, removed) === placementDocumentKey(collection, doc.id, view))
}

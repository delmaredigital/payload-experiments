import type { PayloadRequest } from 'payload'
import type { DocId } from '../types/contracts.js'

// Keep this module adapter-only: the §7.8 exception does not permit Local API calls.

/** §7.8 make-content: the published main row, so Payload's draft baseline never fills a field (KI-1). */
export async function publishedContent(req: PayloadRequest, collection: string, id: DocId) {
  return req.payload.db.findOne<Record<string, unknown> & { id: DocId }>({ collection, req, where: { id: { equals: id } },
    // Static allow-list marker only; adapter reads have no access layer.
    overrideAccess: true,
  } as Parameters<PayloadRequest['payload']['db']['findOne']>[0])
}

/** §7.8 make-content: the latest draft version, so restoring the draft never drops fields the manager cannot read (KI-1). */
export async function latestDraftContent(req: PayloadRequest, collection: string, id: DocId): Promise<(Record<string, unknown> & { id: DocId }) | undefined> {
  const { docs } = await req.payload.db.findVersions<Record<string, unknown>>({ collection, req, limit: 1, pagination: false,
    sort: '-updatedAt', where: { and: [{ parent: { equals: id } }, { latest: { equals: true } }] },
    // Static allow-list marker only; adapter reads have no access layer.
    overrideAccess: true,
  } as Parameters<PayloadRequest['payload']['db']['findVersions']>[0])
  return docs[0] ? { ...docs[0].version, id } : undefined
}

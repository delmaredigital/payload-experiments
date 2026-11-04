import type { PayloadRequest } from 'payload'
import type { DocId } from '../types/contracts.js'
import { latestDraftContent } from './publishedContent.js'

/** §7.8: version-identical compares published content raw (ids stripped). */
export async function pageVersionContent(req: PayloadRequest, collection: string, id: DocId) {
  return req.payload.db.findOne<Record<string, unknown> & { id: DocId }>({ collection, req, where: { id: { equals: id } },
    // Adapter read: version-identical compares published content raw (ids stripped).
    overrideAccess: true,
  } as Parameters<PayloadRequest['payload']['db']['findOne']>[0])
}

/** §7.8: status computes a page's published (or never-published draft) path. */
export async function statusPageContent(req: PayloadRequest, collection: string, id: DocId) {
  const doc = await req.payload.db.findOne<Record<string, unknown> & { id: DocId }>({ collection, req, where: { id: { equals: id } },
    // Adapter read: status computes a page's published (or never-published draft) path.
    overrideAccess: true,
  } as Parameters<PayloadRequest['payload']['db']['findOne']>[0])
  if (!doc || doc._status !== 'draft') return doc
  // A formerly published but currently unpublished page still uses its stored main-row path.
  const published = await req.payload.db.findVersions({ collection, req, limit: 1, pagination: false,
    where: { and: [{ parent: { equals: id } }, { 'version._status': { equals: 'published' } }] },
    // Adapter read: status computes a page's published (or never-published draft) path.
    overrideAccess: true,
  } as Parameters<PayloadRequest['payload']['db']['findVersions']>[0])
  return published.docs.length ? doc : await latestDraftContent(req, collection, id) ?? doc
}

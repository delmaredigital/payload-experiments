import type { PayloadRequest } from 'payload'
import { normalisePath } from '../runtime/normalisePath.js'
import type { EndpointContext, PagesResult } from '../types/endpoints.js'
import { XpRefusal } from '../errors.js'

export async function handlePages<TUser extends { id: string | number }>(req: PayloadRequest, { options }: EndpointContext<TUser>): Promise<Response> {
  const query = new URL(req.url ?? 'http://xp.invalid').searchParams
  const collection = options.pages?.collections.find(entry => entry.slug === query.get('collection'))
  if (!collection) throw new XpRefusal('unknown-collection', "That page type isn't set up for tests.", undefined, 422)
  const path = query.get('path')
  if (path !== null && (!path.length || path.length > 2048 || query.has('q'))) throw new XpRefusal('invalid-body', 'Enter a valid request body.', undefined, 422)
  const page = Number(query.get('page') ?? 1)
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new XpRefusal('invalid-body', 'Choose a valid page.', undefined, 422)
  const config = req.payload.config.collections.find(entry => entry.slug === collection.slug)
  const titleField = config?.admin.useAsTitle ?? 'title'
  const drafts = Boolean(config?.versions && config.versions.drafts)
  const q = query.get('q')?.trim().slice(0, 100)
  if (path !== null) {
    const found = await collection.findByPath(path, req)
    if (!found) return Response.json({ docs: [], hasNextPage: false } satisfies PagesResult, { headers: { 'Cache-Control': 'no-store' } })
    const main = await req.payload.findByID({ collection: collection.slug, id: found.id, req, overrideAccess: false, depth: 0, draft: false, disableErrors: true })
    if (!main) return Response.json({ docs: [], hasNextPage: false } satisfies PagesResult, { headers: { 'Cache-Control': 'no-store' } })
    const published = !drafts || main._status === 'published'
    const doc = published ? main : await req.payload.findByID({ collection: collection.slug, id: main.id, req, overrideAccess: false, depth: 0, draft: true, disableErrors: true })
    if (!doc) return Response.json({ docs: [], hasNextPage: false } satisfies PagesResult, { headers: { 'Cache-Control': 'no-store' } })
    const rawPath = collection.pathOf(doc)
    return Response.json({ docs: [{ id: main.id, title: titleField !== 'id' && typeof doc[titleField] === 'string' && String(doc[titleField]).trim() ? String(doc[titleField]) : '', path: rawPath, pathKey: rawPath === null ? null : normalisePath(rawPath), published }], hasNextPage: false } satisfies PagesResult, { headers: { 'Cache-Control': 'no-store' } })
  }
  const result = await req.payload.find({ collection: collection.slug, req, overrideAccess: false, depth: 0, draft: false,
    sort: '-createdAt', limit: 20, page, where: q && titleField !== 'id' ? { [titleField]: { like: q } } : undefined })
  const docs = await Promise.all(result.docs.map(async main => {
    const published = !drafts || main._status === 'published'
    const doc = published ? main : await req.payload.findByID({ collection: collection.slug, id: main.id, req, overrideAccess: false, depth: 0, draft: true })
    const path = collection.pathOf(doc)
    return { id: main.id, title: String(doc[titleField] ?? main.id), path, pathKey: path === null ? null : normalisePath(path), published }
  }))
  return Response.json({ docs, hasNextPage: result.hasNextPage } satisfies PagesResult, { headers: { 'Cache-Control': 'no-store' } })
}

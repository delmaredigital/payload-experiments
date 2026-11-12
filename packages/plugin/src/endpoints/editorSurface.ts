import type { PayloadRequest } from 'payload'
import { buildSurfaceProps } from '../admin/views/buildSurfaceProps.js'

/** The same request-scoped configuration the admin view sends this user. */
export async function handleEditorSurface(req: PayloadRequest): Promise<Response> {
  const props = await buildSurfaceProps({ req, route: 'test', searchParams: {} })
    ?? await buildSurfaceProps({ req, route: 'results', searchParams: {} })
  if (!props) return Response.json({ errors: [{ code: 'forbidden', message: 'Access denied' }] }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } })
  const { route: _route, id: _id, pages: _pages, returnToTest: _return, ...surface } = props
  return Response.json(surface, { headers: { 'Cache-Control': 'private, no-store' } })
}

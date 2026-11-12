import type { PayloadRequest } from 'payload'
import type { EditorTestSurface } from '../testSurface/surface/contracts.js'
import { buildSurfaceProps } from '../admin/views/buildSurfaceProps.js'

/** Request-scoped context for ExperimentsEditorProvider. Uses the admin's own
 * serializers and access checks; no client permission inference or new endpoint.
 */
export async function getExperimentsEditorSurface(req: PayloadRequest): Promise<EditorTestSurface> {
  const props = await buildSurfaceProps({ req, route: 'test', searchParams: {} })
    ?? await buildSurfaceProps({ req, route: 'results', searchParams: {} })
  if (!props) return { canManage: false, canReadResults: false, isAdmin: false, flagPoints: [], attributeKeys: {}, metricSources: [] }
  const { adminRoute: _admin, apiRoute: _api, route: _route, id: _id, pages: _pages, returnToTest: _return, ...surface } = props
  return surface
}

import type { AdminViewProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { notFound, redirect } from 'next/navigation.js'
import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import { serializeAttributeKeys, serializeFlagPoints, serializeMetricSources } from '../../collections/serialize.js'
import { xpOptionsFromReq } from '../../options/fromReq.js'
import type { ExperimentsAccess } from '../../types/contracts.js'
import type { FlagDefault } from '../../types/manifest.js'
import type { TestsRoute, TestsSurfaceProps } from '../../types/surface.js'
import { XP_TESTS_SURFACE } from '../paths.js'
import { SURFACE_COPY } from '../copy/surface.js'
import { routeAccess } from './access.model.js'

export async function ExperimentsRootView({ initPageResult, params, searchParams }: Pick<AdminViewProps, 'initPageResult' | 'params' | 'searchParams'>) {
  const { req } = initPageResult
  const adminRoute = req.payload.config.routes.admin
  const segments = (await params)?.segments
  const path = Array.isArray(segments) ? segments : []
  const tail = path[0] === 'experiments' ? path.slice(1) : path
  let route: TestsRoute
  let id: string | undefined
  if (tail.length === 0) route = 'home'
  else if (tail.length === 1 && tail[0] === 'new') route = 'new'
  else if (tail.length === 1) { route = 'test'; id = tail[0] }
  else if (tail.length === 2 && tail[1] === 'results') { route = 'results'; id = tail[0] }
  else return notFound()

  if (!req.user) {
    const { login } = req.payload.config.admin.routes
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(await searchParams ?? {})) {
      if (Array.isArray(value)) value.forEach(item => query.append(key, item))
      else if (value !== undefined) query.set(key, String(value))
    }
    const currentPath = formatAdminURL({ adminRoute,
      path: `/experiments${tail.length ? `/${tail.map(encodeURIComponent).join('/')}` : ''}${query.size ? `?${query}` : ''}` })
    return redirect(formatAdminURL({ adminRoute,
      path: `${login}?redirect=${encodeURIComponent(currentPath)}` }))
  }
  const options = xpOptionsFromReq(req)
  async function permits(access: ExperimentsAccess): Promise<boolean> {
    try { return await access({ req }) === true } catch { return false }
  }
  const canManage = await permits(options.access.manage)
  const canReadResults = options.access.readResults ? await permits(options.access.readResults) : canManage
  if (routeAccess({ route, hasUser: true, canManage, canReadResults }) !== 'ok') {
    return <div style={{ padding: 'var(--base)', color: 'var(--theme-text)', background: 'var(--theme-bg)' }}>{SURFACE_COPY.noAccess}</div>
  }

  const flagPoints = serializeFlagPoints(options)
  // xp-state is manager-readable only. Results-only readers do not edit settings.
  if (canManage && flagPoints.length) {
    const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
    const defaults = state.flagDefaults as Record<string, FlagDefault> | undefined
    for (const point of flagPoints) point.effectiveDefaults = defaults?.[point.id]?.params ?? point.defaultParams
  }
  const descriptions = options.admin?.descriptions
  const clientProps: TestsSurfaceProps = {
    route, ...(id === undefined ? {} : { id }), adminRoute, apiRoute: req.payload.config.routes.api,
    canManage, canReadResults, flagPoints,
    attributeKeys: serializeAttributeKeys(options), metricSources: serializeMetricSources(options),
    ...(descriptions ? { admin: { descriptions: { ...descriptions } } } : {}),
  }
  return RenderServerComponent({ Component: XP_TESTS_SURFACE, Fallback: TestsSurfaceFallback, importMap: req.payload.importMap, clientProps })
}

function TestsSurfaceFallback() {
  return <div role="alert" style={{ padding: 'var(--base)', color: 'var(--theme-text)', background: 'var(--theme-bg)' }}>{SURFACE_COPY.notInstalled}</div>
}

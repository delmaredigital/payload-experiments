import { accentStyles } from '../../ui/accent.js'
import type { AdminViewServerProps } from 'payload'
import { flattenTopLevelFields, formatAdminURL } from 'payload/shared'
import { notFound, redirect } from 'next/navigation.js'
import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import { serializeAttributeKeys, serializeFlagPoints, serializeMetricSources } from '../../collections/serialize.js'
import { serializePageCollections } from '../pageCollections.js'
import { collectionLabel as resolveLabel } from '../../collections/labels.js'
import { documentEditor, puckCollections } from '../../options.js'
import { xpOptionsFromReq } from '../../options/fromReq.js'
import type { ExperimentsAccess } from '../../types/contracts.js'
import type { FlagDefault } from '../../types/manifest.js'
import type { TestsRoute, TestsSurfaceProps } from '../../types/surface.js'
import { XP_TESTS_SURFACE } from '../paths.js'
import { SURFACE_COPY } from '../copy/surface.js'
import { routeAccess } from './access.model.js'

export async function ExperimentsRootView({ initPageResult, params, searchParams }: Pick<AdminViewServerProps, 'initPageResult' | 'params' | 'searchParams'>) {
  const { req } = initPageResult
  const adminRoute = req.payload.config.routes.admin
  const segments = (await params)?.segments
  const path = Array.isArray(segments) ? segments : []
  const tail = path[0] === 'experiments' ? path.slice(1) : path
  let route: TestsRoute
  let id: string | undefined
  if (tail.length === 0) route = 'home'
  else if (tail.length === 1 && tail[0] === 'new') route = 'new'
  else if (tail.length === 1 && tail[0] === 'goals') route = 'goals'
  else if (tail.length === 2 && tail[0] === 'goals') { route = tail[1] === 'new' ? 'goalNew' : 'goal'; if (route === 'goal') id = tail[1] }
  else if (tail.length === 1) { route = 'test'; id = tail[0] }
  else if (tail.length === 2 && tail[0] === 'by-slug') { route = 'test'; id = tail[1] }
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
  // Keep the server export importable in plain Node; Next loads the CSS-bearing client boundary when this view renders.
  const { RootViewMessage } = await import('../components/RootViewMessage.js')
  const options = xpOptionsFromReq(req)
  async function permits(access: ExperimentsAccess): Promise<boolean> {
    try { return await access({ req }) === true } catch { return false }
  }
  const canManage = await permits(options.access.manage)
  const isAdmin = options.access.admin ? await permits(options.access.admin) : false
  const canReadResults = options.access.readResults ? await permits(options.access.readResults) : canManage
  if (routeAccess({ route, hasUser: true, canManage, canReadResults }) !== 'ok') {
    return <RootViewMessage>{SURFACE_COPY.noAccess}</RootViewMessage>
  }

  if (canManage && id && tail[0] === 'by-slug') {
    const result = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1, where: { slug: { equals: id } } })
    if (!result.docs[0]) return notFound()
    id = String(result.docs[0].id)
  }
  const flagPoints = serializeFlagPoints(options)
  // xp-state is manager-readable only. Results-only readers do not edit settings.
  if (canManage && flagPoints.length) {
    const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
    const defaults = state.flagDefaults as Record<string, FlagDefault> | undefined
    for (const point of flagPoints) point.effectiveDefaults = defaults?.[point.id]?.params ?? point.defaultParams
  }
  const registrations = puckCollections(options)
  const pages = route === 'new' && canManage && options.puck?.enabled && registrations.length ? (await Promise.all(registrations.map(async ({ slug: collection }) => {
    try {
      const config = req.payload.config.collections.find(item => item.slug === collection)
      const useAsTitle = config?.admin.useAsTitle ?? 'id'
      const collectionLabel = resolveLabel(config?.labels.plural, collection, req)
      // appliesTo may inspect any stored field; ordinary Puck lists keep their title-only projection.
      const predicateFields = options.blocks?.collections.some(entry => entry.slug === collection)
        ? Object.fromEntries(flattenTopLevelFields(config?.fields ?? []).map(field => [field.name, true])) : {}
      const result = await req.payload.find({ collection, req, overrideAccess: false, depth: 0,
        limit: 50, sort: '-updatedAt', draft: true, select: { [useAsTitle]: true, ...predicateFields } })
      // The new-test list uses the latest draft's editing intent, as the "Test a block" field condition does (§4.1).
      return result.docs.map(doc => {
        if (documentEditor(options, collection, doc) !== 'puck') return null
        const id = doc.id
        const customUrl = options.admin?.editorUrl?.({ collection, id, draft: true, editor: documentEditor(options, collection, doc), doc })
        const title = doc[useAsTitle]
        return { collection, collectionLabel, id, title: typeof title === 'string' || typeof title === 'number' ? String(title) : String(id),
          editorUrl: typeof customUrl === 'string' ? customUrl : formatAdminURL({ adminRoute, path: `/collections/${collection}/${encodeURIComponent(String(id))}` }) }
      }).filter((page): page is NonNullable<typeof page> => page !== null)
    } catch { return [] }
  }))).flat() : undefined
  const descriptions = options.admin?.descriptions
  const returnToTest = (await searchParams)?.return
  const clientProps: TestsSurfaceProps = {
    ...(typeof returnToTest === 'string' && /^[\w-]+$/.test(returnToTest) ? { returnToTest } : {}),
    route, ...(id === undefined ? {} : { id }), adminRoute, apiRoute: req.payload.config.routes.api,
    canManage, canReadResults, isAdmin, flagPoints, ...(pages === undefined ? {} : { pages }),
    pageCollections: serializePageCollections(options.pages?.collections ?? [], req),
    attributeKeys: serializeAttributeKeys(options), metricSources: serializeMetricSources(options),
    ...(descriptions ? { admin: { descriptions: { ...descriptions } } } : {}),
  }
  function TestsSurfaceFallback() {
    return <RootViewMessage alert>{SURFACE_COPY.notInstalled}</RootViewMessage>
  }
  const css = accentStyles(options.theme?.accent)
  const surface = RenderServerComponent({ Component: XP_TESTS_SURFACE, Fallback: TestsSurfaceFallback, importMap: req.payload.importMap, clientProps })
  return css ? <><style>{css}</style>{surface}</> : surface
}

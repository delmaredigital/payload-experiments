import type { AdminViewServerProps, PayloadRequest } from 'payload'
import { flattenTopLevelFields, formatAdminURL } from 'payload/shared'
import { serializeAttributeKeys, serializeFlagPoints, serializeMetricSources } from '../../collections/serialize.js'
import { serializePageCollections } from '../pageCollections.js'
import { collectionLabel as resolveLabel } from '../../collections/labels.js'
import { documentEditor, puckCollections } from '../../options.js'
import { xpOptionsFromReq } from '../../options/fromReq.js'
import type { ExperimentsAccess } from '../../types/contracts.js'
import type { FlagDefault } from '../../types/manifest.js'
import type { TestsRoute, TestsSurfaceProps } from '../../types/surface.js'
import { routeAccess } from './access.model.js'

export async function buildSurfaceProps({ req, route, id, searchParams }: {
  req: PayloadRequest; route: TestsRoute; id?: string; searchParams: AdminViewServerProps['searchParams']
}): Promise<TestsSurfaceProps | null> {
  if (!req.user) return null
  const adminRoute = req.payload.config.routes.admin
  const options = xpOptionsFromReq(req)
  async function permits(access: ExperimentsAccess): Promise<boolean> {
    try { return await access({ req }) === true } catch { return false }
  }
  const canManage = await permits(options.access.manage)
  const isAdmin = options.access.admin ? await permits(options.access.admin) : false
  const canReadResults = options.access.readResults ? await permits(options.access.readResults) : canManage
  if (routeAccess({ route, hasUser: true, canManage, canReadResults }) !== 'ok') {
    return null
  }

  const flagPoints = serializeFlagPoints(options)
  // xp-state is manager-readable only. Results-only readers do not edit settings.
  if (canManage && flagPoints.length) {
    const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
    const defaults = state.flagDefaults as Record<string, FlagDefault> | undefined
    for (const point of flagPoints) point.effectiveDefaults = defaults?.[point.id]?.params ?? point.defaultParams
  }
  const registrations = [...new Set([...(options.puck?.enabled ? puckCollections(options) : []), ...options.blocks?.collections ?? []].map(entry => entry.slug))]
  const pages = route === 'new' && canManage && registrations.length ? (await Promise.all(registrations.map(async collection => {
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
        const editor = documentEditor(options, collection, doc)
        if (editor !== 'puck' && editor !== 'blocks') return null
        const id = doc.id
        const customUrl = options.admin?.editorUrl?.({ collection, id, draft: true, editor, doc })
        const title = doc[useAsTitle]
        return { collection, collectionLabel, id, editor, title: typeof title === 'string' || typeof title === 'number' ? String(title) : String(id),
          editorUrl: typeof customUrl === 'string' ? customUrl : formatAdminURL({ adminRoute, path: `/collections/${collection}/${encodeURIComponent(String(id))}` }) }
      }).filter((page): page is NonNullable<typeof page> => page !== null)
    } catch { return [] }
  }))).flat() : undefined
  const descriptions = options.admin?.descriptions
  const returnToTest = (await searchParams)?.return
  return {
    ...(typeof returnToTest === 'string' && /^[\w-]+$/.test(returnToTest) ? { returnToTest } : {}),
    route, ...(id === undefined ? {} : { id }), adminRoute, apiRoute: req.payload.config.routes.api,
    canManage, canReadResults, isAdmin, flagPoints, ...(pages === undefined ? {} : { pages }),
    pageCollections: serializePageCollections(options.pages?.collections ?? [], req),
    collectionTitles: Object.fromEntries(req.payload.config.collections.flatMap(collection => {
      const title = collection.admin.useAsTitle
      return title && title !== 'id' ? [[collection.slug, title]] : []
    })),
    userId: req.user.id, userCollection: req.payload.config.admin.user,
    attributeKeys: serializeAttributeKeys(options), metricSources: serializeMetricSources(options),
    ...(descriptions ? { admin: { descriptions: { ...descriptions } } } : {}),
  }
}

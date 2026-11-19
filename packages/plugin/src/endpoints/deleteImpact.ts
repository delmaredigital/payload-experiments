import { Forbidden, type PayloadRequest } from 'payload'
import { localeRequest, placementLocaleViews } from '../blocks/placementLocale.js'
import { XpRefusal } from '../errors.js'
import { compileManifest, loadManifestInputs, type ManifestInputExperiment } from '../manifest/compile.js'
import { puckCollections } from '../options.js'
import { scanBlockPlacements } from '../transitions/placements.js'
import type { DeleteImpactResult, EndpointContext } from '../types/endpoints.js'
import type { ArmSlot } from '../types/puck.js'
import { routeId } from './routeId.js'

/** Advisory read only. Delete keeps its own access check, status guard and transaction. */
export async function handleDeleteImpact<TUser extends { id: string | number }>(req: PayloadRequest, { options }: EndpointContext<TUser>): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' }
  const reply = (result: DeleteImpactResult) => Response.json(result, { headers })
  const id = routeId(req)
  if (id === undefined) throw new XpRefusal('not-found', 'Experiment not found', undefined, 404)
  const { docs } = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1,
    where: { id: { equals: id } } })
  const experiment = docs[0] as unknown as ManifestInputExperiment | undefined
  if (!experiment) throw new XpRefusal('not-found', 'Experiment not found', undefined, 404)
  if (experiment.status !== 'draft' && experiment.status !== 'archived') throw new XpRefusal('invalid-status', 'This test cannot be deleted in its current status.', undefined, 409)
  const { decision, kind } = experiment
  if (experiment.status === 'draft' || !decision?.winnerArm || decision.discardedAt || kind !== 'block' && kind !== 'page'
    || kind === 'page' && decision.pagesReleasedAt || kind === 'block' && decision.winnerArm === 'control') return reply({ effect: 'none' })

  // Use the live builder's complete inputs and ordering, including archived address collisions.
  const inputs = await loadManifestInputs(req)
  let manifest: ReturnType<typeof compileManifest>
  try { manifest = compileManifest(inputs, 0, { attributeKeys: options.attributeKeys }) }
  catch (cause) { throw new XpRefusal('placement-unchecked', 'The effect of deleting this test could not be determined.', undefined, 422, { cause }) }
  if (kind === 'page') {
    const after = compileManifest({ ...inputs, excludeIds: [id] }, 0, { attributeKeys: options.attributeKeys })
    const routes = Object.entries(manifest.archivedPages).filter(([path, route]) => route.slug === experiment.slug && (after.archivedPages[path]?.winnerPath ?? path) !== route.winnerPath)
    const afterPaths = Object.fromEntries(routes.flatMap(([path]) => after.archivedPages[path] ? [[path, after.archivedPages[path]!.winnerPath]] : []))
    return reply(routes.length ? { effect: 'page', winnerPath: routes[0]![1].winnerPath, addresses: routes.map(([path]) => path),
      ...(Object.keys(afterPaths).length ? { afterPaths } : {}) } : { effect: 'none' })
  }
  const winnerSlot = manifest.archivedWinners[experiment.slug] as ArmSlot | undefined
  if (!winnerSlot || winnerSlot === 'control') return reply({ effect: 'none' })
  const phase = inputs.experiments.find(test => String(test.id) === String(id))?.lastTestPhase
  const winner = phase?.arms.find(arm => arm.key === decision.winnerArm)
  const control = phase?.arms.find(arm => arm.key === 'control')
  if (!winner || !control) throw new XpRefusal('placement-unchecked', 'The effect of deleting this test could not be determined.', undefined, 422)
  const affected: Extract<DeleteImpactResult, { effect: 'block' }>['placements'] = []
  const changedPages = new Set<string>(), readablePages = new Set<string>()
  const puck = options.puck?.enabled ? puckCollections(options) : []
  const blocks = options.blocks?.collections ?? []
  for (const collection of new Set([...puck, ...blocks].map(entry => entry.slug))) {
    for (const view of placementLocaleViews(req, collection)) {
      const viewReq = view.locale ? localeRequest(req, view) : req
      // The route is manager-gated. Count the entire visitor surface, then disclose only access-checked page details.
      const placements = await scanBlockPlacements(viewReq, { slug: experiment.slug, puckCollections: puck.filter(entry => entry.slug === collection),
        blocksCollections: blocks.filter(entry => entry.slug === collection), publishedOnly: true, pageGuard: true, localeView: view })
      const changed = placements.filter(place => place.published && (place.editor !== 'blocks' || place.slots[winnerSlot]) && (place.slots[winnerSlot] || place.slots.control))
      if (!changed.length) continue
      for (const place of changed) changedPages.add(JSON.stringify([collection, String(place.id)]))
      // find applies Where-scoped read access as well as a boolean refusal. Never disclose the privileged document.
      let readable: Array<Record<string, unknown> & { id: string | number }> = []
      try {
        const result = await req.payload.find({ collection, req: viewReq, overrideAccess: false, depth: 0, draft: false, pagination: false, limit: 0,
          locale: view.locale || undefined, fallbackLocale: view.locale ? view.fallbackLocale : undefined,
          where: { id: { in: [...new Set(changed.map(place => place.id))] } } })
        readable = result.docs
      } catch (cause) { if (!(cause instanceof Forbidden) && (cause as { status?: number })?.status !== 403) throw cause }
      for (const place of changed) {
        const doc = readable.find(doc => String(doc.id) === String(place.id))
        if (!doc) continue
        readablePages.add(JSON.stringify([collection, String(place.id)]))
        const registration = options.pages?.collections.find(entry => entry.slug === collection)
        let path: string | null = null
        try { const value = registration?.pathOf(doc); if (typeof value === 'string') path = value } catch { /* An optional public path cannot fail the impact check. */ }
        const titleField = req.payload.config.collections?.find(entry => entry.slug === collection)?.admin?.useAsTitle
        affected.push({ collection, id: place.id,
          title: String((titleField ? doc[titleField] : undefined) ?? doc.title ?? doc.name ?? doc.id), path,
          before: place.slots[winnerSlot] ? { key: winner.key, label: winner.label } : { key: 'empty', label: 'Nothing' },
          after: place.slots.control ? { key: control.key, label: control.label } : { key: 'empty', label: 'Nothing' } })
      }
    }
  }
  return reply(changedPages.size ? { effect: 'block', controlLabel: control.label, pageCount: changedPages.size,
    unreadablePages: [...changedPages].filter(key => !readablePages.has(key)).length, placements: affected } : { effect: 'none' })
}

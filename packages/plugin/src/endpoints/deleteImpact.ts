import { Forbidden, type PayloadRequest } from 'payload'
import { XpRefusal } from '../errors.js'
import { compileManifest, loadManifestInputs, type ManifestInputExperiment } from '../manifest/compile.js'
import { publishedBlockPlacementPages } from '../transitions/placements.js'
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
  req.signal?.throwIfAborted()
  let inputs: Awaited<ReturnType<typeof loadManifestInputs>>
  let manifest: ReturnType<typeof compileManifest>
  try {
    inputs = await loadManifestInputs(req, { signal: req.signal })
    manifest = compileManifest(inputs, 0, { attributeKeys: options.attributeKeys })
  } catch (cause) {
    req.signal?.throwIfAborted()
    throw new XpRefusal('placement-unchecked', 'The effect of deleting this test could not be determined.', undefined, 422, { cause })
  }
  req.signal?.throwIfAborted()
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
  for await (const { collection, placements } of publishedBlockPlacementPages(req, options, experiment.slug)) {
    const changed = placements.filter(place => (place.editor !== 'blocks' || place.slots[winnerSlot]) && (place.slots[winnerSlot] || place.slots.control))
    if (!changed.length) continue
    const byPage = new Map<string, typeof changed>()
    for (const place of changed) {
      const key = String(place.id)
      changedPages.add(JSON.stringify([collection, key]))
      const page = byPage.get(key) ?? []
      page.push(place); byPage.set(key, page)
    }
    req.signal?.throwIfAborted()
    // find applies Where-scoped read access as well as a boolean refusal. Never disclose the privileged document.
    let readable: Array<Record<string, unknown> & { id: string | number }> = []
    try {
      const result = await req.payload.find({ collection, req, overrideAccess: false, depth: 0, draft: false, pagination: false, limit: 0,
        where: { id: { in: [...byPage.values()].map(places => places[0]!.id) } } })
      readable = result.docs
    } catch (cause) { if (!(cause instanceof Forbidden) && (cause as { status?: number })?.status !== 403) throw cause }
    req.signal?.throwIfAborted()
    for (const doc of readable) {
      const places = byPage.get(String(doc.id))
      if (!places?.length) continue
      readablePages.add(JSON.stringify([collection, String(doc.id)]))
      const registration = options.pages?.collections.find(entry => entry.slug === collection)
      let path: string | null = null
      try {
        const value = registration?.pathOf(doc)
        if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.split(/[/?#]/).some(segment => /^(undefined|null)$/i.test(decodeURIComponent(segment)))) path = value
      } catch { /* An optional public path cannot fail the impact check. */ }
      const titleField = req.payload.config.collections?.find(entry => entry.slug === collection)?.admin?.useAsTitle
      const locales = [...new Set(places.flatMap(place => place.locale ? [place.locale] : []))]
      const version = (slot: ArmSlot, arm: { key: string; label: string }) => {
        const values = new Map(places.map(place => place.slots[slot] ? [arm.key, arm.label] : ['empty', 'Nothing']))
        return { key: [...values.keys()].join(','), label: [...values.values()].join(' / ') }
      }
      // Page access controls metadata disclosure; a hidden layout field does not hide a readable page's visitor effect.
      affected.push({ collection, id: doc.id,
        title: String((titleField ? doc[titleField] : undefined) ?? doc.title ?? doc.name ?? doc.id), path,
        ...(locales.length ? { locales } : {}), before: version(winnerSlot, winner), after: version('control', control) })
    }
  }
  return reply(changedPages.size ? { effect: 'block', controlLabel: control.label, pageCount: changedPages.size,
    unreadablePages: [...changedPages].filter(key => !readablePages.has(key)).length, placements: affected } : { effect: 'none' })
}

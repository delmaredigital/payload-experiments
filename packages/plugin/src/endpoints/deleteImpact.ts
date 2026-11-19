import type { PayloadRequest } from 'payload'
import { XpRefusal } from '../errors.js'
import { compileManifest, type ManifestInputExperiment, type ManifestPhase } from '../manifest/compile.js'
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

  const phases = await req.payload.find({ collection: 'xp-phases', req, overrideAccess: false, depth: 0, limit: 1, sort: '-phase',
    where: { experiment: { equals: id }, phaseKind: { equals: 'test' } } })
  const lastTestPhase = phases.docs[0] as unknown as ManifestPhase | undefined
  // Compile the same frozen routing as the runtime. Missing phase data is a failed check, never "no effect".
  const manifest = compileManifest({ experiments: [{ ...experiment, currentPhase: null, lastTestPhase }], flagDefaults: {} }, 0)
  if (kind === 'page') {
    const routes = Object.entries(manifest.archivedPages)
    return reply(routes.length ? { effect: 'page', winnerPath: routes[0]![1].winnerPath, addresses: routes.map(([path]) => path) } : { effect: 'none' })
  }
  const winnerSlot = manifest.archivedWinners[experiment.slug] as ArmSlot | undefined
  if (!winnerSlot || winnerSlot === 'control') return reply({ effect: 'none' })
  const winner = lastTestPhase!.arms.find(arm => arm.key === decision.winnerArm)!
  const control = lastTestPhase!.arms.find(arm => arm.key === 'control')!
  const placements = await scanBlockPlacements(req, { slug: experiment.slug, puckCollections: options.puck?.enabled ? options.puck.collections : [],
    blocksCollections: options.blocks?.collections ?? [], publishedOnly: true })
  const affected: Extract<DeleteImpactResult, { effect: 'block' }>['placements'] = []
  for (const placement of placements) {
    // Native blocks already fall back to Original if the winner's slot has no content.
    if (!placement.published || placement.editor === 'blocks' && !placement.slots[winnerSlot]) continue
    const registration = options.pages?.collections.find(entry => entry.slug === placement.collection)
    const path = registration && placement.doc ? registration.pathOf(placement.doc)
      : await options.admin?.previewUrl?.(placement) ?? null
    const titleField = req.payload.config.collections?.find(entry => entry.slug === placement.collection)?.admin?.useAsTitle
    affected.push({ collection: placement.collection, id: placement.id,
      title: titleField && placement.doc?.[titleField] != null ? String(placement.doc[titleField]) : placement.title,
      path, before: { key: winner.key, label: winner.label }, after: { key: control.key, label: control.label } })
  }
  return reply(affected.length ? { effect: 'block', placements: affected } : { effect: 'none' })
}

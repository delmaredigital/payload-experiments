import type { PayloadRequest } from 'payload'
import type { BlockPlacement } from './placements.js'

/** Read through manager access, on both preflight and Start's locked rescan. */
export async function nestedPlacementNames(req: PayloadRequest, placements: readonly BlockPlacement[]): Promise<Map<string, string>> {
  const slugs = [...new Set(placements.flatMap(p => (p.nestedTests ?? []).flatMap(pair => [pair.outer, pair.inner])))]
  if (!slugs.length) return new Map()
  const found = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, pagination: false, where: { slug: { in: slugs } } })
  return new Map(found.docs.map(doc => [String(doc.slug), String(doc.name)]))
}
export const nameNestedPlacements = (placements: readonly BlockPlacement[], names: ReadonlyMap<string, string>): BlockPlacement[] =>
  placements.map(p => ({ ...p, nestedTests: p.nestedTests?.map(pair => ({ outer: names.get(pair.outer) ?? pair.outer, inner: names.get(pair.inner) ?? pair.inner })) }))

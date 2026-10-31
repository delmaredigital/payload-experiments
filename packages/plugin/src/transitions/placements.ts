import type { PayloadRequest } from 'payload'
import type { Arm, DocId, FlagPoint, ResolvedOptions } from '../types/contracts.js'
import type { ArmSlot } from '../types/puck.js'

export interface BlockPlacement {
  collection: string; id: DocId; title: string; published: boolean
  slots: Record<ArmSlot, number>; locked?: boolean
}
export type FlagPlacement = Awaited<ReturnType<NonNullable<FlagPoint['placements']>>>[number]
const slots = ['control', 'variantA', 'variantB', 'variantC'] as const

/** Each matching ExperimentSlot is checked separately, including multiple slots
 * in one document: content elsewhere in the document cannot hide an empty slot.
 */
export async function scanBlockPlacements(req: PayloadRequest, { slug, puckCollections }: {
  slug: string; puckCollections: string[]
}): Promise<BlockPlacement[]> {
  const placements: BlockPlacement[] = []
  for (const collection of puckCollections) {
    const publishedIds = new Set<string>()
    const draftsEnabled = req.payload.config.collections?.some(config => config.slug === collection && config.versions && config.versions.drafts)
    for (const draft of [false, true]) {
      let page = 1
      while (true) {
        const result = await req.payload.find({
          collection, req, overrideAccess: false, limit: 100, page, depth: 0, draft,
          ...(!draft && draftsEnabled ? { where: { _status: { equals: 'published' } } } : {}),
        })
        for (const doc of result.docs) {
          if (!draft && doc._status === 'draft') continue
          if (draft && doc._status !== 'draft' && publishedIds.has(String(doc.id))) continue
          if (!draft) publishedIds.add(String(doc.id))
          function walk(value: unknown): void {
            if (!value || typeof value !== 'object') return
            if (Array.isArray(value)) { value.forEach(walk); return }
            const node = value as Record<string, unknown>
            const props = node.props as Record<string, unknown> | undefined
            const ref = props?.experiment
            const experiment = typeof ref === 'string' ? ref : ref && typeof ref === 'object' && 'slug' in ref ? ref.slug : null
            if (node.type === 'ExperimentSlot' && props && experiment === slug) {
              placements.push({ collection, id: doc.id, title: String(doc.title ?? doc.name ?? doc.id),
                published: !draft || doc._status === 'published',
                slots: Object.fromEntries(slots.map(slot => [slot, Array.isArray(props[slot]) ? props[slot].length : 0])) as Record<ArmSlot, number>,
                ...(typeof doc.locked === 'boolean' ? { locked: doc.locked } : {}),
              })
            }
            Object.values(node).forEach(walk)
          }
          walk(doc.puckData)
        }
        if (!result.hasNextPage) break
        page++
      }
    }
  }
  return placements
}

export async function flagPlacements<TUser extends { id: DocId }>(options: ResolvedOptions<TUser>, experiment: {
  id: DocId; flagPoint?: string | null; arms: Arm[]
}, req: PayloadRequest): Promise<FlagPlacement[]> {
  const point = options.flagPoints?.find(point => point.id === experiment.flagPoint)
  return point?.placements?.({ experimentId: experiment.id, arms: experiment.arms.map(arm => arm.key), req }) ?? []
}

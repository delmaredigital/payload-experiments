import { hasLocalizedFields } from './contentFields.js'
import type { PayloadRequest } from 'payload'
import type { Arm, DocId, FlagPoint, ResolvedOptions } from '../types/contracts.js'
import type { ArmSlot } from '../types/puck.js'
import { puckCollections as normalisePuckCollections } from '../options.js'

export interface BlockPlacement {
  collection: string; id: DocId; title: string; published: boolean
  slots: Record<ArmSlot, number>; locked?: boolean; localized?: boolean
}
export type FlagPlacement = Awaited<ReturnType<NonNullable<FlagPoint['placements']>>>[number]
const slots = ['control', 'variantA', 'variantB', 'variantC'] as const

/** Each matching ExperimentSlot is checked separately, including multiple slots
 * in one document: content elsewhere in the document cannot hide an empty slot.
 */
export function scanBlockPlacements(req: PayloadRequest, args: {
  slug: string; puckCollections: NonNullable<ResolvedOptions['puck']>['collections']
}): Promise<BlockPlacement[]>
export function scanBlockPlacements(req: PayloadRequest, args: {
  slugs: ReadonlySet<string>; puckCollections: NonNullable<ResolvedOptions['puck']>['collections']
}): Promise<Map<string, BlockPlacement[]>>
export async function scanBlockPlacements(req: PayloadRequest, args: {
  slug?: string; slugs?: ReadonlySet<string>; puckCollections: NonNullable<ResolvedOptions['puck']>['collections']
}): Promise<BlockPlacement[] | Map<string, BlockPlacement[]>> {
  const { puckCollections } = args
  const slugs = args.slugs ?? new Set([args.slug!])
  const placements = new Map([...slugs].map(slug => [slug, [] as BlockPlacement[]]))
  for (const { slug: collection, field } of normalisePuckCollections({ puck: { enabled: true, collections: puckCollections } })) {
    const publishedIds = new Set<string>()
    const draftsEnabled = req.payload.config.collections?.some(config => config.slug === collection && config.versions && config.versions.drafts)
    for (const draft of [false, true]) {
      let page = 1
      while (true) {
        const result = await req.payload.find({
          collection, req, overrideAccess: false, limit: 100, page, depth: 0, draft, includeLockStatus: true,
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
            if (node.type === 'ExperimentSlot' && props && typeof experiment === 'string' && slugs.has(experiment)) {
              placements.get(experiment)!.push({ collection, id: doc.id, title: String(doc.title ?? doc.name ?? doc.id),
                published: !draft || doc._status === 'published',
                slots: Object.fromEntries(slots.map(slot => [slot, Array.isArray(props[slot]) ? props[slot].length : 0])) as Record<ArmSlot, number>,
                ...(hasLocalizedFields(req.payload.config.collections?.find(config => config.slug === collection)?.fields ?? [], req.payload.config.blocks) ? { localized: true } : {}),
                locked: doc._isLocked === true || doc.locked === true,
              })
            }
            Object.values(node).forEach(walk)
          }
          walk(doc[field])
        }
        if (!result.hasNextPage) break
        page++
      }
    }
  }
  return args.slugs ? placements : placements.get(args.slug!)!
}

export async function flagPlacements<TUser extends { id: DocId }>(options: ResolvedOptions<TUser>, experiment: {
  id: DocId; flagPoint?: string | null; arms: Arm[]
}, req: PayloadRequest): Promise<FlagPlacement[]> {
  const point = options.flagPoints?.find(point => point.id === experiment.flagPoint)
  if (!point?.placements) return []
  return point.placements({ experimentId: experiment.id, arms: experiment.arms.filter(arm => arm.kind !== 'holdout').map(arm => arm.key), req })
}

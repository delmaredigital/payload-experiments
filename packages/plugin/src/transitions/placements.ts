import { BLOCK_SLOTS, EXPERIMENT_BLOCK_SLUG, hostBlocks, slotBlocks } from '../blocks/model.js'
import { safeError } from '../log.js'
import { pageVersionContent } from '../db/pageContent.js'
import { comparableContent } from './pageVersions.js'
import { isDeepStrictEqual } from 'node:util'
import { hasLocalizedFields } from './contentFields.js'
import type { PayloadRequest } from 'payload'
import type { Arm, DocId, FlagPoint, PreviewPlacement, ResolvedOptions } from '../types/contracts.js'
import type { ArmSlot } from '../types/puck.js'
import { documentEditor, puckCollections as normalisePuckCollections } from '../options.js'

export interface BlockPlacement extends PreviewPlacement {
  editor?: 'puck' | 'blocks' | 'page'; doc?: Record<string, unknown>
  slots: Record<ArmSlot, number>; duplicateRows?: boolean; identicalSlots?: string[]; locked?: boolean; localized?: boolean
}
export type FlagPlacement = Awaited<ReturnType<NonNullable<FlagPoint['placements']>>>[number]
const slots = ['control', 'variantA', 'variantB', 'variantC'] as const

/** Internal page-guard overlay: simulate the pending write using the same scan as Start.
 * Draft-only writes retain the published view. Publish/unpublish replace both views.
 */
export interface PlacementChange {
  collection: string; id: DocId; draftOnly?: boolean; doc?: Record<string, unknown>
}
interface ScanOptions {
  puckCollections: NonNullable<ResolvedOptions['puck']>['collections']
  blocksCollections: NonNullable<ResolvedOptions['blocks']>['collections']
  compareVersions?: boolean
  /** Hook reads must see every placement and must never invoke nested access checks (CORE-21). */
  pageGuard?: true
  change?: PlacementChange
}
async function placementDocuments(req: PayloadRequest, query: Parameters<PayloadRequest['payload']['find']>[0], guard?: true) {
  // §7.8 page guard: the hook must see test placements regardless of the editor's access.
  if (guard) return req.payload.find({ ...query, req, overrideAccess: true })
  return req.payload.find({ ...query, req, overrideAccess: false })
}
function changedDocuments(docs: Array<Record<string, unknown> & { id: DocId }>, change: PlacementChange | undefined,
  collection: string, draft: boolean, page: number, draftsEnabled: boolean): Array<Record<string, unknown> & { id: DocId }> {
  if (!change || change.collection !== collection || change.draftOnly && !draft) return docs
  const kept = docs.filter(doc => String(doc.id) !== String(change.id))
  const doc = change.doc
  if (page === 1 && doc && (draft ? change.draftOnly || doc._status === 'draft' : !draftsEnabled || doc._status === 'published')) {
    kept.push({ ...doc, id: change.id, ...(change.draftOnly ? { _status: 'draft' } : {}) })
  }
  return kept
}

/** Each matching ExperimentSlot is checked separately, including multiple slots
 * in one document: content elsewhere in the document cannot hide an empty slot.
 */
export function scanBlockPlacements(req: PayloadRequest, args: ScanOptions & { slug: string }): Promise<BlockPlacement[]>
export function scanBlockPlacements(req: PayloadRequest, args: ScanOptions & { slugs: ReadonlySet<string> }): Promise<Map<string, BlockPlacement[]>>
export async function scanBlockPlacements(req: PayloadRequest, args: ScanOptions & { slug?: string; slugs?: ReadonlySet<string> }): Promise<BlockPlacement[] | Map<string, BlockPlacement[]>> {
  const { puckCollections } = args
  const slugs = args.slugs ?? new Set([args.slug!])
  const placements = new Map([...slugs].map(slug => [slug, [] as BlockPlacement[]]))
  for (const { slug: collection, field } of normalisePuckCollections({ puck: { enabled: true, collections: puckCollections } })) {
    const editors = new Map<string, string>()
    const publishedIds = new Set<string>()
    const publishedSlugs = new Map<string, string>()
    const draftsEnabled = req.payload.config.collections?.some(config => config.slug === collection && config.versions && config.versions.drafts)
    for (const draft of [false, true]) {
      let page = 1
      while (true) {
        const result = await placementDocuments(req, {
          collection, req, overrideAccess: false, limit: 100, page, depth: 0, draft, includeLockStatus: true,
          ...(!draft && draftsEnabled ? { where: { _status: { equals: 'published' } } } : {}),
        }, args.pageGuard)
        for (const doc of changedDocuments(result.docs, args.change, collection, draft, page, Boolean(draftsEnabled))) {
          if (!draft && doc._status === 'draft') continue
          if (draft && doc._status !== 'draft' && publishedIds.has(String(doc.id))) continue
          if (!draft) {
            editors.set(String(doc.id), documentEditor({ puck: { enabled: true, collections: puckCollections }, blocks: { collections: args.blocksCollections } }, collection, doc))
            publishedIds.add(String(doc.id))
            if (typeof doc.slug === 'string') publishedSlugs.set(String(doc.id), doc.slug)
          }
          const editor = editors.get(String(doc.id)) ?? documentEditor({ puck: { enabled: true, collections: puckCollections }, blocks: { collections: args.blocksCollections } }, collection, doc)
          if (editor !== 'puck') continue
          function walk(value: unknown): void {
            if (!value || typeof value !== 'object') return
            if (Array.isArray(value)) { value.forEach(walk); return }
            const node = value as Record<string, unknown>
            const props = node.props as Record<string, unknown> | undefined
            const ref = props?.experiment
            const experiment = typeof ref === 'string' ? ref : ref && typeof ref === 'object' && 'slug' in ref ? ref.slug : null
            if (node.type === 'ExperimentSlot' && props && typeof experiment === 'string' && slugs.has(experiment)) {
              placements.get(experiment)!.push({ collection, id: doc.id, editor: 'puck', doc, title: String(doc.title ?? doc.name ?? doc.id),
                published: !draft || doc._status === 'published',
                ...(publishedSlugs.has(String(doc.id)) ? { slug: publishedSlugs.get(String(doc.id))! } : {}),
                slots: Object.fromEntries(slots.map(slot => [slot, Array.isArray(props[slot]) ? props[slot].length : 0])) as Record<ArmSlot, number>,
                ...(hasLocalizedFields(req.payload.config.collections?.find(config => config.slug === collection)?.fields ?? [], req.payload.config) ? { localized: true } : {}),
                locked: doc._isLocked === true || doc.locked === true,
              })
            }
            Object.values(node).forEach(walk)
          }
          const offsets = new Map([...placements].map(([slug, list]) => [slug, list.length]))
          walk(doc[field])
          if (args.compareVersions && !draft && [...placements].some(([slug, list]) => list.length > offsets.get(slug)!)) {
            const raw = await comparisonContent(req, collection, doc.id)
            const rawSlots = new Map<string, Array<Record<string, unknown>>>()
            const collect = (value: unknown): void => {
              if (Array.isArray(value)) { value.forEach(collect); return }
              if (!value || typeof value !== 'object') return
              const node = value as Record<string, unknown>, props = node.props as Record<string, unknown> | undefined
              const ref = props?.experiment
              const slug = typeof ref === 'string' ? ref : ref && typeof ref === 'object' && 'slug' in ref ? ref.slug : undefined
              if (node.type === 'ExperimentSlot' && props && typeof slug === 'string') {
                const list = rawSlots.get(slug) ?? []; list.push(props); rawSlots.set(slug, list)
              }
              Object.values(node).forEach(collect)
            }
            if (raw && raw._status !== 'draft') collect(raw[field])
            for (const [slug, list] of placements) list.slice(offsets.get(slug)).forEach((placement, index) => {
              const props = rawSlots.get(slug)?.[index]
              if (props) placement.identicalSlots = slots.filter(slot => slot !== 'control' && Array.isArray(props[slot]) && props[slot].length > 0 && isDeepStrictEqual(comparableContent(props.control ?? []), comparableContent(props[slot])))
            })
          }
        }
        if (!result.hasNextPage) break
        page++
      }
    }
  }
  for (const registration of args.blocksCollections) {
    const { slug: collection, field } = registration
    const published = new Map<string, Record<string, unknown>>()
    const draftsEnabled = req.payload.config.collections?.some(c => c.slug === collection && c.versions && c.versions.drafts)
    for (const draft of [false, true]) {
      let page = 1
      while (true) {
        const result = await placementDocuments(req, { collection, req, overrideAccess: false, depth: 0, limit: 100, page, draft, includeLockStatus: true,
          ...(!draft && draftsEnabled ? { where: { _status: { equals: 'published' } } } : {}) }, args.pageGuard)
        for (const doc of changedDocuments(result.docs, args.change, collection, draft, page, Boolean(draftsEnabled))) {
          if (!draft && doc._status === 'draft') continue
          if (!draft) published.set(String(doc.id), doc)
          else if (doc._status !== 'draft' && published.has(String(doc.id))) continue
          const baseline = published.get(String(doc.id)) ?? doc
          if (documentEditor({ blocks: { collections: args.blocksCollections }, puck: { enabled: true, collections: puckCollections } }, collection, baseline) !== 'blocks') continue
          const raw = args.compareVersions && !draft && hostBlocks(doc[field]).some(block => block.blockType === (registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG) && typeof block.experiment === 'string' && slugs.has(block.experiment)) ? await comparisonContent(req, collection, doc.id) : undefined
          for (const [index, block] of hostBlocks(doc[field]).entries()) {
            if (block.blockType !== (registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG) || typeof block.experiment !== 'string' || !slugs.has(block.experiment)) continue
            const stored = raw ? hostBlocks(raw[field]).find(row => row.id === block.id) ?? hostBlocks(raw[field])[index] ?? block : block
            const rows = Array.isArray(stored.slots) ? stored.slots : []
            const keys = rows.map(row => row?.slot)
            placements.get(block.experiment)!.push({ collection, id: doc.id, editor: 'blocks', doc, title: String(doc.title ?? doc.name ?? doc.id),
              published: !draft || doc._status === 'published', ...(typeof baseline.slug === 'string' ? { slug: baseline.slug } : {}),
              slots: Object.fromEntries(BLOCK_SLOTS.map(slot => [slot, slotBlocks(block, slot).length])) as Record<ArmSlot, number>,
              duplicateRows: new Set(keys).size !== keys.length,
              identicalSlots: raw ? BLOCK_SLOTS.filter(slot => slot !== 'control' && slotBlocks(block, slot).length > 0 && isDeepStrictEqual(comparableContent(slotBlocks(stored, 'control')), comparableContent(slotBlocks(stored, slot)))) : [],
              locked: doc._isLocked === true || doc.locked === true,
              ...(hasLocalizedFields(req.payload.config.collections?.find(c => c.slug === collection)?.fields ?? [], req.payload.config) ? { localized: true } : {}),
            })
          }
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

/** A warning-only comparison must never turn an adapter failure into a Start refusal. */
async function comparisonContent(req: PayloadRequest, collection: string, id: DocId) {
  try { return await pageVersionContent(req, collection, id) }
  catch (cause) {
    req.payload.logger.error({ err: safeError(cause), collection, id }, 'Experiment version comparison failed')
    return undefined
  }
}

import { puckExperimentSlug } from '../puck/experimentSlug.js'
import { walkVisiblePuck } from '../puck/visibility.js'
import { BLOCK_SLOTS, EXPERIMENT_BLOCK_SLUG, hostBlocks, slotBlocks } from '../blocks/model.js'
import { safeError } from '../log.js'
import { pageVersionContent } from '../db/pageContent.js'
import { comparableContent } from './pageVersions.js'
import { isDeepStrictEqual } from 'node:util'
import { hasLocalizedFields } from './contentFields.js'
import type { PayloadRequest } from 'payload'
import type { Arm, DocId, FlagPoint, PreviewPlacement, ResolvedOptions } from '../types/contracts.js'
import type { ArmSlot } from '../types/puck.js'
import { localeRequest, placementReader, type PlacementLocaleView } from '../blocks/placementLocale.js'
import { puckCollections as normalisePuckCollections } from '../options.js'

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
  /** Read the current visitor surface without fetching newer unpublished drafts. */
  publishedOnly?: boolean
  /** Hooks and manager-authorized visitor-impact reads must see every placement (CORE-21). */
  pageGuard?: true
  change?: PlacementChange
}
async function placementDocuments(req: PayloadRequest, query: Parameters<PayloadRequest['payload']['find']>[0], guard?: true) {
  // §7.8 page guard / visitor impact: count all placements regardless of the editor's access; impact details are checked separately.
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

/** Published rows only, one pass per collection across both editor registrations.
 * The exclusion predicate reads live transaction claims after each awaited page.
 */
export async function hasOtherPublishedBlockPlacement(req: PayloadRequest, options: ResolvedOptions, slug: string,
  excluded: (collection: string, id: DocId, view: PlacementLocaleView, doc: Record<string, unknown> & { id: DocId }) => boolean): Promise<boolean> {
  const scanReq = localeRequest(req, { locale: req.payload.config.localization ? 'all' : req.locale ?? '', fallbackLocale: false })
  const collections = new Set([...normalisePuckCollections(options).map(entry => entry.slug),
    ...(options.blocks?.collections ?? []).map(entry => entry.slug)])
  for (const collection of collections) {
    const drafts = req.payload.config.collections?.some(c => c.slug === collection && c.versions && c.versions.drafts)
    const reader = placementReader(req, collection, options)
    let page = 1
    while (true) {
      req.signal?.throwIfAborted()
      const result = await placementDocuments(scanReq, { collection, overrideAccess: false, limit: 100, page, depth: 0, draft: false,
        ...(req.payload.config.localization ? { locale: 'all' as const, fallbackLocale: false as const } : {}),
        ...(drafts ? { where: { _status: { equals: 'published' } } } : {}),
      }, true)
      req.signal?.throwIfAborted()
      if (result.docs.some(doc => doc._status !== 'draft' && doc.deletedAt == null && reader.views.some(view => reader.read(doc, 'all-locales', view).slugs.includes(slug)
          && !excluded(collection, doc.id, view, doc)))) return true
      if (!result.hasNextPage) break
      page++
    }
  }
  return false
}

interface PublishedBlockPlacement { id: DocId; editor: 'puck' | 'blocks'; slots: BlockPlacement['slots']; locale?: string }

/** Visitor-impact scan: one published read per collection page. Resolve every
 * visitor locale, including configured fallbacks; the endpoint groups by page.
 */
export async function* publishedBlockPlacementPages(req: PayloadRequest, options: Pick<ResolvedOptions, 'puck' | 'blocks'>, slug: string): AsyncGenerator<{
  collection: string; placements: PublishedBlockPlacement[]
}> {
  const scanReq = localeRequest(req, { locale: req.payload.config.localization ? 'all' : req.locale ?? '', fallbackLocale: false })
  const puck = options.puck?.enabled ? normalisePuckCollections(options) : [], blocks = options.blocks?.collections ?? []
  for (const collection of new Set([...puck, ...blocks].map(entry => entry.slug))) {
    const drafts = req.payload.config.collections?.some(c => c.slug === collection && c.versions && c.versions.drafts)
    const reader = placementReader(req, collection, options)
    let page = 1
    while (true) {
      req.signal?.throwIfAborted()
      const result = await placementDocuments(scanReq, { collection, overrideAccess: false, limit: 100, page, depth: 0, draft: false,
        ...(req.payload.config.localization ? { locale: 'all' as const, fallbackLocale: false as const } : {}),
        ...(drafts ? { where: { _status: { equals: 'published' } } } : {}),
      }, true)
      req.signal?.throwIfAborted()
      const placements: PublishedBlockPlacement[] = []
      for (const raw of result.docs) {
        if (raw._status === 'draft' || raw.deletedAt != null) continue
        for (const view of reader.views) {
          const placement = reader.read(raw, 'all-locales', view)
          const doc = placement.doc!
          const add = (contents: Record<ArmSlot, number>, editor: 'puck' | 'blocks') => placements.push({ id: raw.id, editor, slots: contents, ...(view.locale ? { locale: view.locale } : {}) })
          if (placement.editor === 'puck') {
            const registration = puck.find(entry => entry.slug === collection)
            if (registration) walkVisiblePuck(doc[registration.field], (node, visibility) => {
              if (!visibility.hidden && node.type === 'ExperimentSlot' && puckExperimentSlug(node.props.experiment) === slug) {
                add(Object.fromEntries(slots.map(slot => [slot, Array.isArray(node.props[slot]) ? node.props[slot].length : 0])) as Record<ArmSlot, number>, 'puck')
              }
            })
          } else {
            const registration = blocks.find(entry => entry.slug === collection)
            if (registration) for (const block of hostBlocks(doc[registration.field])) {
              if (block.blockType === (registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG) && block.experiment === slug) {
                add(Object.fromEntries(BLOCK_SLOTS.map(slot => [slot, slotBlocks(block, slot).length])) as Record<ArmSlot, number>, 'blocks')
              }
            }
          }
        }
      }
      yield { collection, placements }
      if (!result.hasNextPage) break
      page++
    }
  }
}

/** Each matching ExperimentSlot is checked separately, including multiple slots
 * in one document: content elsewhere in the document cannot hide an empty slot.
 */
export function scanBlockPlacements(req: PayloadRequest, args: ScanOptions & { slug: string }): Promise<BlockPlacement[]>
export function scanBlockPlacements(req: PayloadRequest, args: ScanOptions & { slugs: ReadonlySet<string> }): Promise<Map<string, BlockPlacement[]>>
export async function scanBlockPlacements(req: PayloadRequest, args: ScanOptions & { slug?: string; slugs?: ReadonlySet<string> }): Promise<BlockPlacement[] | Map<string, BlockPlacement[]>> {
  const { puckCollections } = args
  const scanReq = localeRequest(req, { locale: req.locale === 'all' ? req.payload.config.localization ? req.payload.config.localization.defaultLocale : '' : req.locale ?? '', fallbackLocale: req.fallbackLocale ?? false })
  const slugs = args.slugs ?? new Set([args.slug!])
  const placements = new Map([...slugs].map(slug => [slug, [] as BlockPlacement[]]))
  for (const { slug: collection, field } of normalisePuckCollections({ puck: { enabled: true, collections: puckCollections } })) {
    const reader = placementReader(req, collection, { puck: { enabled: true, collections: puckCollections }, blocks: { collections: args.blocksCollections } })
    const editors = new Map<string, string>()
    const publishedIds = new Set<string>()
    const publishedSlugs = new Map<string, string>()
    const draftsEnabled = req.payload.config.collections?.some(config => config.slug === collection && config.versions && config.versions.drafts)
    for (const draft of args.publishedOnly ? [false] : [false, true]) {
      let page = 1
      while (true) {
        const result = await placementDocuments(scanReq, {
          collection, req, overrideAccess: false, limit: 100, page, depth: 0, draft, includeLockStatus: true,
          ...(!draft && draftsEnabled ? { where: { _status: { equals: 'published' } } } : {}),
        }, args.pageGuard)
        for (const localized of changedDocuments(result.docs, args.change, collection, draft, page, Boolean(draftsEnabled))) {
          const doc = reader.read(localized, 'localized').doc as typeof localized
          if (!draft && doc._status === 'draft') continue
          if (draft && doc._status !== 'draft' && publishedIds.has(String(doc.id))) continue
          if (!draft) {
            editors.set(String(doc.id), reader.read(doc, 'localized').editor)
            publishedIds.add(String(doc.id))
            if (typeof doc.slug === 'string') publishedSlugs.set(String(doc.id), doc.slug)
          }
          const editor = editors.get(String(doc.id)) ?? reader.read(doc, 'localized').editor
          if (editor !== 'puck') continue
          const offsets = new Map([...placements].map(([slug, list]) => [slug, list.length]))
          walkVisiblePuck(doc[field], (node, visibility) => {
            if (visibility.hidden) return
            const props = node.props
            const experiment = puckExperimentSlug(props.experiment)
            if (node.type === 'ExperimentSlot' && typeof experiment === 'string' && slugs.has(experiment)) {
              placements.get(experiment)!.push({ collection, id: doc.id, editor: 'puck', doc, title: String(doc.title ?? doc.name ?? doc.id),
                published: !draft || doc._status === 'published',
                ...(publishedSlugs.has(String(doc.id)) ? { slug: publishedSlugs.get(String(doc.id))! } : {}),
                slots: Object.fromEntries(slots.map(slot => [slot, Array.isArray(props[slot]) ? props[slot].length : 0])) as Record<ArmSlot, number>,
                ...(hasLocalizedFields(req.payload.config.collections?.find(config => config.slug === collection)?.fields ?? [], req.payload.config) ? { localized: true } : {}),
                locked: doc._isLocked === true || doc.locked === true,
              })
            }
          })
          if (args.compareVersions && !draft && [...placements].some(([slug, list]) => list.length > offsets.get(slug)!)) {
            const raw = reader.read(await comparisonContent(req, collection, doc.id), 'all-locales').doc
            const rawSlots = new Map<string, Array<Record<string, unknown>>>()
            const collect = (value: unknown): void => walkVisiblePuck(value, (node, visibility) => {
              if (visibility.hidden) return
              const props = node.props
              const slug = puckExperimentSlug(props?.experiment)
              if (node.type === 'ExperimentSlot' && props && typeof slug === 'string') {
                const list = rawSlots.get(slug) ?? []; list.push(props); rawSlots.set(slug, list)
              }
            })
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
    const reader = placementReader(req, collection, { puck: { enabled: true, collections: puckCollections }, blocks: { collections: args.blocksCollections } })
    const published = new Map<string, Record<string, unknown>>()
    const draftsEnabled = req.payload.config.collections?.some(c => c.slug === collection && c.versions && c.versions.drafts)
    for (const draft of args.publishedOnly ? [false] : [false, true]) {
      let page = 1
      while (true) {
        const result = await placementDocuments(scanReq, { collection, req, overrideAccess: false, depth: 0, limit: 100, page, draft, includeLockStatus: true,
          ...(!draft && draftsEnabled ? { where: { _status: { equals: 'published' } } } : {}) }, args.pageGuard)
        for (const localized of changedDocuments(result.docs, args.change, collection, draft, page, Boolean(draftsEnabled))) {
          const doc = reader.read(localized, 'localized').doc as typeof localized
          if (!draft && doc._status === 'draft') continue
          if (!draft) published.set(String(doc.id), doc)
          else if (doc._status !== 'draft' && published.has(String(doc.id))) continue
          const baseline = published.get(String(doc.id)) ?? doc
          if (reader.read(baseline, 'localized').editor !== 'blocks') continue
          const raw = args.compareVersions && !draft && hostBlocks(doc[field]).some(block => block.blockType === (registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG) && typeof block.experiment === 'string' && slugs.has(block.experiment)) ? reader.read(await comparisonContent(req, collection, doc.id), 'all-locales').doc : undefined
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

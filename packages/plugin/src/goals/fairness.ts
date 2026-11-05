import type { PayloadRequest } from 'payload'
import type { Arm, DocId, ResolvedOptions } from '../types/contracts.js'
import type { PlacementDoc } from '../db/placements.js'
import { clickGoalContent } from '../db/clickGoals.js'
import { safeError } from '../log.js'
import { documentEditor, puckCollections } from '../options.js'
import { EXPERIMENT_BLOCK_SLUG, hostBlocks, isObject, slotBlocks } from '../blocks/model.js'
import { resolvePageCollection } from '../transitions/pageCollection.js'
import { scanPlacements, uniquePlacementDocs } from '../transitions/placementInteractions.js'
import { CLICK_KEY } from './key.js'

export const OUTSIDE_GOAL = "This goal isn't inside the part being tested, so every version shows it the same way."
export const LEGACY_FAIRNESS = "Goal fairness isn't checked for tests started before this update."
export interface GoalPlacement { collection?: string; id?: DocId; path?: string; title?: string }
export interface GoalContent {
  keys: Array<{ key: string; arms: string[]; label: string }>
  unchecked: GoalPlacement[]
  readArms: string[]
  skipped?: boolean
}
type Experiment = { id: DocId; slug: string; kind: string; arms: Arm[]; pageCollection?: string | null }

/** Inspect inline JSON only; depth-zero relationship ids never dereference another document. */
function collect(value: unknown, into: Map<string, string>, label = '', labels: ReadonlyMap<string, string>): void {
  if (Array.isArray(value)) { value.forEach(item => collect(item, into, label, labels)); return }
  if (!isObject(value)) return
  const blockType = typeof value.blockType === 'string' ? value.blockType : typeof value.type === 'string' ? value.type : ''
  const containing = labels.get(blockType) ?? (blockType || label)
  if (typeof value.xpGoal === 'string' && CLICK_KEY.test(value.xpGoal)) into.set(value.xpGoal, containing || value.xpGoal)
  Object.values(value).forEach(item => collect(item, into, containing, labels))
}

function blockLabels(req: PayloadRequest): Map<string, string> {
  const labels = new Map<string, string>()
  function walk(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!isObject(value)) return
    if (typeof value.slug === 'string' && isObject(value.labels) && typeof value.labels.singular === 'string') labels.set(value.slug, value.labels.singular)
    for (const key of ['blocks', 'fields', 'tabs']) walk(value[key])
  }
  walk(req.payload.config.collections)
  walk(req.payload.config.blocks)
  return labels
}

/** Call outside a transition, or on Start's detached request after its locks.
 * Frozen null placements are deliberately skipped by results (no anonymous scan).
 */
export async function goalContent<TUser extends { id: DocId }>(req: PayloadRequest, options: ResolvedOptions<TUser>, experiment: Experiment,
  placements?: readonly PlacementDoc[] | null): Promise<GoalContent> {
  if (experiment.kind !== 'page' && experiment.kind !== 'block') return { keys: [], unchecked: [], readArms: [], skipped: true }
  const byArm = new Map(experiment.arms.filter(a => a.kind !== 'holdout').map(a => [a.key, new Map<string, string>()]))
  const labels = blockLabels(req), unchecked: GoalPlacement[] = [], readArms = new Set<string>()
  const failed = (error: unknown, placement: GoalPlacement) => {
    unchecked.push(placement)
    req.payload.logger.error({ err: safeError(error), experimentId: experiment.id, collection: placement.collection, id: placement.id }, 'Experiment click goal content lookup failed')
  }
  if (experiment.kind === 'page') {
    let collection
    try { collection = await resolvePageCollection(req, options, experiment, true) }
    catch (error) { failed(error, {}); return { keys: [], unchecked, readArms: [] } }
    if (!collection?.contentOf) return { keys: [], unchecked, readArms: [], skipped: true }
    for (const arm of experiment.arms.filter(a => a.kind !== 'holdout' && a.pageTarget)) {
      const placement = { collection: collection.slug, path: arm.pageTarget! }
      try {
        const page = await collection.findByPath(arm.pageTarget!, req)
        if (!page?.published) { unchecked.push(placement); continue }
        const doc = await clickGoalContent(req, collection.slug, page.id)
        if (!doc) { unchecked.push({ ...placement, id: page.id }); continue }
        collect(collection.contentOf(doc), byArm.get(arm.key)!, '', labels)
        readArms.add(arm.key)
      } catch (error) { failed(error, placement) }
    }
  } else if (experiment.kind === 'block') {
    if (placements === null) return { keys: [], unchecked, readArms: [], skipped: true }
    let docs = placements
    if (!docs) {
      try { docs = uniquePlacementDocs((await scanPlacements(req, options, experiment.slug)).filter(placement => placement.published)) }
      catch (error) { failed(error, {}); return { keys: [], unchecked, readArms: [] } }
    }
    for (const placement of docs) {
      try {
        const doc = await clickGoalContent(req, placement.collection, placement.id)
        if (!doc) { unchecked.push(placement); continue }
        const editor = documentEditor(options, placement.collection, doc)
        if (editor === 'blocks') {
          const registration = options.blocks?.collections.find(c => c.slug === placement.collection)
          if (!registration) continue
          for (const block of hostBlocks(doc[registration.field])) {
            if (block.blockType !== (registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG) || block.experiment !== experiment.slug) continue
            for (const arm of experiment.arms.filter(a => a.kind !== 'holdout')) collect(slotBlocks(block, arm.slot ?? arm.key), byArm.get(arm.key)!, '', labels)
          }
        } else {
          const registration = puckCollections(options).find(c => c.slug === placement.collection)
          if (!registration) continue
          const walk = (value: unknown): void => {
            if (Array.isArray(value)) { value.forEach(walk); return }
            if (!isObject(value)) return
            const props = isObject(value.props) ? value.props : undefined
            const ref = props?.experiment
            if (value.type === 'ExperimentSlot' && props && (typeof ref === 'string' ? ref : isObject(ref) ? ref.slug : undefined) === experiment.slug) {
              for (const arm of experiment.arms.filter(a => a.kind !== 'holdout')) collect(props[arm.slot ?? arm.key], byArm.get(arm.key)!, '', labels)
              return
            }
            Object.values(value).forEach(walk)
          }
          walk(doc[registration.field])
        }
        for (const arm of byArm.keys()) readArms.add(arm)
      } catch (error) { failed(error, placement) }
    }
  }
  const rows = new Map<string, { key: string; arms: string[]; label: string }>()
  for (const arm of experiment.arms) {
    // Holdout renders the Original and has no row or slot of its own.
    const key = arm.kind === 'holdout' ? experiment.arms.find(a => a.kind === 'control')?.key : arm.key
    if (key && readArms.has(key)) readArms.add(arm.key)
    for (const [goal, label] of (key ? byArm.get(key) : undefined) ?? []) {
      const row = rows.get(goal) ?? { key: goal, arms: [], label }
      row.arms.push(arm.key); rows.set(goal, row)
    }
  }
  return { keys: [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)), unchecked, readArms: [...readArms] }
}

/** Readiness detail contains placement identifiers only. */
export function goalPlacementDetail({ collection, id, path }: GoalPlacement): Omit<GoalPlacement, 'title'> {
  return { ...(collection === undefined ? {} : { collection }), ...(id === undefined ? {} : { id }), ...(path === undefined ? {} : { path }) }
}

export function asymmetricGoal(content: GoalContent, source: string, arms: readonly { key: string }[]): boolean {
  if (content.skipped) return false
  const row = content.keys.find(row => `click:${row.key}` === source)
  const read = arms.filter(arm => content.readArms.includes(arm.key))
  return !!row && read.some(arm => row.arms.includes(arm.key)) && read.some(arm => !row.arms.includes(arm.key))
}

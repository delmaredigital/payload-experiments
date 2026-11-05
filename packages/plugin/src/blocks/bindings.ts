import { documentEditor, puckCollections } from '../options.js'
import type { ResolvedOptions } from '../types/contracts.js'
import { EXPERIMENT_BLOCK_SLUG, hostBlocks, isObject } from './model.js'

/** Same document-kind rule as the scan; Payload blocks are top level, Puck is recursive. */
export function placementSlugs(options: Pick<ResolvedOptions, 'blocks' | 'puck'>, collection: string, doc: Record<string, unknown> | undefined): string[] {
  if (!doc) return []
  const editor = documentEditor(options, collection, doc)
  if (editor === 'blocks') {
    const registration = options.blocks?.collections.find(r => r.slug === collection)
    if (!registration) return []
    return [...new Set(hostBlocks(doc[registration.field]).flatMap(block => block.blockType === (registration.blockSlug ?? EXPERIMENT_BLOCK_SLUG) && typeof block.experiment === 'string' ? [block.experiment] : []))]
  }
  if (editor !== 'puck') return []
  const registration = puckCollections(options).find(r => r.slug === collection)
  const found = new Set<string>()
  function walk(v: unknown) {
    if (Array.isArray(v)) { v.forEach(walk); return }
    if (!isObject(v)) return
    if (v.type === 'ExperimentSlot' && isObject(v.props)) {
      const ref = v.props.experiment, slug = typeof ref === 'string' ? ref : isObject(ref) ? ref.slug : undefined
      if (typeof slug === 'string') found.add(slug)
    }
    Object.values(v).forEach(walk)
  }
  if (registration) walk(doc[registration.field])
  return [...found]
}

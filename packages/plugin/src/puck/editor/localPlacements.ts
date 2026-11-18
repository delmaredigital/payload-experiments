import { walkVisiblePuck, type BlockVisibility } from '../visibility.js'
import type { Data } from '@puckeditor/core'

// Puck data is immutable. Selection, hover and drag state reuse this
// result, and every block on the page shares a single traversal per data change.
const pages = new WeakMap<Data, Map<string, Set<string>>>()
export function localPlacements(data: Data): Map<string, Set<string>> {
  let placements = pages.get(data)
  if (!placements) {
    placements = new Map()
    walkVisiblePuck(data, (item, visibility) => {
      const ref = item.props.experiment as { id?: unknown } | null | undefined
      if (!visibility.hidden && item.type === 'ExperimentSlot' && ref && ref.id !== undefined) {
        const key = String(ref.id)
        const ids = placements!.get(key) ?? new Set<string>()
        ids.add(String(item.props.id))
        placements!.set(key, ids)
      }
    })
    pages.set(data, placements)
  }
  return placements
}

const visibilityPages = new WeakMap<Data, Map<string, BlockVisibility>>()
export function localBlockVisibility(data: Data, id: string): BlockVisibility | undefined {
  let blocks = visibilityPages.get(data)
  if (!blocks) {
    blocks = new Map()
    walkVisiblePuck(data, (block, visibility) => blocks!.set(String(block.props.id), visibility))
    visibilityPages.set(data, blocks)
  }
  return blocks.get(id)
}

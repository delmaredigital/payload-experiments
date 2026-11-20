import { EXPERIMENT_SLOT_TYPE } from '../types/puck.js'
import { puckExperimentSlug } from './experimentSlug.js'
import { walkVisiblePuck, type PuckBlock } from './visibility.js'

export interface NestedTest { outer: PuckBlock; inner: PuckBlock }

/** The placement traversal owns block shape, legacy zones and inherited visibility.
 * Paste supplies its destination ancestors and includes hidden/unbound blocks.
 */
export function nestedTests(data: unknown, { includeHidden = false, ancestors = [] }: {
  includeHidden?: boolean; ancestors?: readonly PuckBlock[]
} = {}): NestedTest[] {
  const result: NestedTest[] = []
  walkVisiblePuck(data, (inner, visibility, parents) => {
    if ((!includeHidden && visibility.hidden) || inner.type !== EXPERIMENT_SLOT_TYPE) return
    for (const outer of [...ancestors, ...parents]) {
      if (outer.type === EXPERIMENT_SLOT_TYPE) result.push({ outer, inner })
    }
  })
  return result
}

export const nestedTestSlug = (block: PuckBlock) => puckExperimentSlug(block.props.experiment)
export const nestedTestLabel = (block: PuckBlock) => nestedTestSlug(block) || 'Unconfigured test'
export const nestedTestKey = ({ outer, inner }: NestedTest) => JSON.stringify([
  outer.props.id, nestedTestSlug(outer), inner.props.id, nestedTestSlug(inner),
])

import type { ComponentData } from '@puckeditor/core'
import { EXPERIMENT_SLOT_TYPE } from '../../types/puck.js'
import { editorCopy } from './copy.js'

// Structural subset of payload-puck's CanPasteArgs: keep the integration
// independent of that optional host package, including erased type imports.
type PasteArgs = {
  block: ComponentData
  destination: { ancestors: readonly { type: string }[] }
}

export function canPasteExperiment({ block, destination }: PasteArgs): true | string {
  if (!destination.ancestors.some(ancestor => ancestor.type === EXPERIMENT_SLOT_TYPE)) return true
  const pending: unknown[] = [block]
  const seen = new WeakSet<object>()
  while (pending.length) {
    const value = pending.pop()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    const node = value as Record<string, unknown>
    if (node.type === EXPERIMENT_SLOT_TYPE && node.props && typeof node.props === 'object' && !Array.isArray(node.props)) {
      return editorCopy.nestedPaste
    }
    for (const child of Object.values(value)) pending.push(child)
  }
  return true
}

// Spread into the component config so older Puck typings and hosts accept the
// extra key. payload-puck 0.12.1 invokes it; 0.12.0 simply ignores it.
export const experimentClipboard = { blockClipboard: { canPaste: canPasteExperiment } }

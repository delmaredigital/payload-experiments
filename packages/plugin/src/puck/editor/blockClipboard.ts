import type { ComponentData } from '@puckeditor/core'
import { nestedTests } from '../nestedTests.js'
import { editorCopy } from './copy.js'

// Structural subset of payload-puck's CanPasteArgs: keep the integration
// independent of that optional host package, including erased type imports.
type PasteArgs = {
  block: ComponentData
  destination: { ancestors: readonly { type: string }[] }
}

export function canPasteExperiment({ block, destination }: PasteArgs): true | string {
  const ancestors = destination.ancestors.map(ancestor => ({ type: ancestor.type, props: {} }))
  if (nestedTests(block, { includeHidden: true, ancestors }).length) return editorCopy.nestedPaste
  return true
}

// Spread into the component config so older Puck typings and hosts accept the
// extra key. payload-puck 0.12.1 invokes it; 0.12.0 simply ignores it.
export const experimentClipboard = { blockClipboard: { canPaste: canPasteExperiment } }

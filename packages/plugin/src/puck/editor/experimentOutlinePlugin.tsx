'use client'

import { createUsePuck, walkTree, type ComponentData, type Plugin } from '@puckeditor/core'
import type { ReactNode } from 'react'
import { EXPERIMENT_SLOT_TYPE, type ArmSlot, type ExperimentRef } from '../../types/puck.js'
import { useArms } from './armsCache.js'

const usePuckSelector = createUsePuck()
const slots: ArmSlot[] = ['control', 'variantA', 'variantB', 'variantC']
// Puck 0.24.0 dist/chunk-DQXMVPVM.mjs:8040 (item attribute), 8126–8135
// (direct zone containers). Zones have no stable attribute; avoid the CSS-module hash.
const zone = 'div[class*="Layer-zones"]'
const chain = (count: number) => Array<string>(count).fill(zone).join(' ~ ')

function SlotRules({ item }: { item: ComponentData }) {
  const testId = (item.props.experiment as ExperimentRef | null | undefined)?.id
  const known = useArms(testId)
  const rules = slots.flatMap((slot, index) => {
    // Original always remains available. Unknown bound tests must reveal every zone.
    if (slot === 'control' || (testId !== undefined && (!known || known.arms.includes(slot)))) return []
    const content: unknown = item.props[slot]
    if (Array.isArray(content) && content.length > 0) return []
    // Exactly the nth zone sibling: the positive chain matches n onward and the
    // negated chain excludes n+1 onward. Unlike nth-child, DropLine siblings do not count.
    const selector = `li[data-puck-layer-tree-id="${CSS.escape(item.props.id)}"] > ${chain(index + 1)}:not(${chain(index + 2)})`
    return [`${selector} { display: none; }`]
  }).join('\n')
  return <style data-xp-outline={item.props.id}>{rules}</style>
}

function ExperimentOutline({ children }: { children: ReactNode }) {
  // Public selector API in Puck 0.24, rather than the deprecated usePuck hook.
  const data = usePuckSelector(state => state.appState.data)
  const config = usePuckSelector(state => state.config)
  const items = new Map<string, ComponentData>()
  const collect = (content: ComponentData[]) => {
    for (const item of content) if (item.type === EXPERIMENT_SLOT_TYPE) items.set(item.props.id, item)
  }
  walkTree(data, config, content => { collect(content) })
  // walkTree visits slots inside legacy zones, but does not call back on the zone itself.
  for (const content of Object.values(data.zones ?? {})) collect(content)
  return <>{children}{[...items.values()].map(item => <SlotRules key={item.props.id} item={item} />)}</>
}

/** Add to Puck's plugins so its outline wrapper composes with the host's overrides. */
export function experimentOutlinePlugin(): Plugin {
  return { name: 'experiment-outline', overrides: { outline: ExperimentOutline } }
}

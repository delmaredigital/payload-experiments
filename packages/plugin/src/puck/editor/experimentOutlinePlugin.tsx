'use client'

import { createUsePuck, walkTree, type ComponentData, type Plugin } from '@puckeditor/core'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EXPERIMENT_SLOT_TYPE, type ArmSlot, type ExperimentRef } from '../../types/puck.js'
import { useArms } from './armsCache.js'

const usePuckSelector = createUsePuck()
const slots: ArmSlot[] = ['control', 'variantA', 'variantB', 'variantC']
// Puck 0.24.0 dist/chunk-DQXMVPVM.mjs:8040 (item attribute), 8126–8135
// (direct zone containers). Zones have no stable attribute; avoid the CSS-module hash.
const zone = 'div[class*="Layer-zones"]'
const chain = (count: number) => Array<string>(count).fill(zone).join(' ~ ')

type OutlineItem = [id: string, testId: string | null, emptySlots: boolean[]]

function SlotRules({ item: [id, testId, emptySlots] }: { item: OutlineItem }) {
  const known = useArms(testId ?? undefined)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  // CSS.escape is a browser API: SSR and the first hydration render emit no rules.
  if (!mounted) return null
  const rules = slots.flatMap((slot, index) => {
    // Original always remains available. Unknown bound tests must reveal every zone.
    if (slot === 'control' || (testId !== null && (!known || known.arms.includes(slot)))) return []
    if (!emptySlots[index]) return []
    // Exactly the nth zone sibling: the positive chain matches n onward and the
    // negated chain excludes n+1 onward. Unlike nth-child, DropLine siblings do not count.
    const selector = `li[data-puck-layer-tree-id="${CSS.escape(id)}"] > ${chain(index + 1)}:not(${chain(index + 2)})`
    return [`${selector} { display: none; }`]
  }).join('\n')
  return <style data-xp-outline={id}>{rules}</style>
}

function ExperimentOutline({ children }: { children: ReactNode }) {
  // Public selector API in Puck 0.24, rather than the deprecated usePuck hook.
  const key = usePuckSelector(state => {
    const { data } = state.appState
    const items = new Map<string, OutlineItem>()
    const collect = (content: ComponentData[]) => {
      for (const item of content) if (item.type === EXPERIMENT_SLOT_TYPE) {
        const testId = (item.props.experiment as ExperimentRef | null | undefined)?.id
        items.set(item.props.id, [item.props.id, testId === undefined ? null : String(testId), slots.map(slot => {
          const content: unknown = item.props[slot]
          return !Array.isArray(content) || content.length === 0
        })])
      }
    }
    walkTree(data, state.config, content => { collect(content) })
    // walkTree visits slots inside legacy zones, but does not call back on the zone itself.
    for (const content of Object.values(data.zones ?? {})) collect(content)
    return JSON.stringify([...items.values()])
  })
  // Only binding/emptiness changes rebuild the rules, not edits to other page fields.
  const rules = useMemo(() => (JSON.parse(key) as OutlineItem[]).map(item => <SlotRules key={item[0]} item={item} />), [key])
  return <>{children}{rules}</>
}

/** Add to Puck's plugins so its outline wrapper composes with the host's overrides. */
export function experimentOutlinePlugin(): Plugin {
  return { name: 'experiment-outline', overrides: { outline: ExperimentOutline } }
}

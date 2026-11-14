'use client'

import { createUsePuck, useGetPuck, walkTree, type ComponentData, type Plugin } from '@puckeditor/core'
import { useId, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { EXPERIMENT_SLOT_TYPE, type ArmSlot, type ExperimentRef } from '../../types/puck.js'
import { slotLabels } from '../copy.js'
import { useOutlineVersion } from './outlineVersion.js'
import { useArms } from './armsCache.js'

const usePuckSelector = createUsePuck()
const slots: ArmSlot[] = ['control', 'variantA', 'variantB', 'variantC']
// Puck 0.24.0: defaultSlots prepends in field order (chunk-H65MT2JK:15–18),
// getZonesByParent/buildLayerNode preserve zone order (chunk-DQXMVPVM:8577–8622),
// and Layer maps it to direct wrappers (8126–8135). Never rely on a module hash.
const zone = 'div[class*="Layer-zones"]'
const chain = (count: number) => Array<string>(count).fill(zone).join(' ~ ')

type OutlineItem = [id: string, testId: string | null, emptySlots: boolean[]]

/** Read Puck's DOM only; the plugin owns the wrapper and the emitted style. */
function SlotRules({ item: [id, testId, emptySlots], root, scope }: { item: OutlineItem; root: RefObject<HTMLDivElement | null>; scope: string }) {
  const known = useArms(testId ?? undefined)
  const active = useOutlineVersion(useGetPuck(), id)
  const dragging = usePuckSelector(state => state.appState.ui?.isDragging ?? false)
  const fixedHidden = useRef<ArmSlot[]>([])
  const style = useRef<HTMLStyleElement>(null)
  useLayoutEffect(() => {
    const ownedStyle = style.current
    const host = root.current ?? ownedStyle?.parentElement
    if (!host || !ownedStyle || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') return
    const rowSelector = `[data-xp-outline-scope="${CSS.escape(scope)}"] li[data-puck-layer-tree-id="${CSS.escape(id)}"]`
    const update = () => {
      const rows = [...host.querySelectorAll(`li[data-puck-layer-tree-id="${CSS.escape(id)}"]`)]
      const row = rows.length === 1 ? rows[0] : undefined
      const zones = row ? [...row.children].filter(child => child.matches(zone)) : []
      // Exact count and static field labels guard sibling position, including after
      // a Puck upgrade, a host override, collapse/expand, reorder or virtualization.
      const valid = !!row && zones.length === slots.length && [...row.children].filter(child => child.matches('div[class*="Layer-inner"]')).length === 1 && [...row.children].every(child =>
        child.matches(`${zone}, div[class*="Layer-inner"], div[class*="DropLine"]`)) && zones.every((child, index) => {
        const label = child.firstElementChild
        const list = label?.nextElementSibling
        return label?.matches('div[class*="LayerTree-zoneTitle"]') && label.textContent?.trim() === slotLabels[slots[index]!] &&
          list?.matches('ul[class*="LayerTree"]') && !list.nextElementSibling
      })
      const unknown = testId !== null && !known
      // A drag's collision shapes were measured before it began. Never hide a
      // previously visible target mid-drag; apply the new tab after it finishes.
      if (!valid || unknown) fixedHidden.current = []
      else if (!dragging) fixedHidden.current = slots.filter((slot, index) => testId !== null && active ? slot !== active : slot !== active && slot !== 'control' && !known?.arms.includes(slot) && emptySlots[index])
      const rules = !valid || unknown ? '' : slots.flatMap((slot, index) => {
        // No canvas tab is mounted: retain the existing empty-unused-slot behavior.
        if (!fixedHidden.current.includes(slot)) return []
        // The count guard also disables the rule synchronously if wrappers change.
        const guard = `:has(> ${chain(slots.length)}):not(:has(> ${chain(slots.length + 1)}))`
        const selector = `${rowSelector}${guard} > ${chain(index + 1)}:not(${chain(index + 2)})`
        // Hidden descendants have no pointer hit area, including zone drop targets.
        return [`${selector} { display: none; pointer-events: none; }`]
      }).join('\n')
      if (ownedStyle.textContent !== rules) ownedStyle.textContent = rules
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(host, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-puck-layer-tree-id'] })
    return () => { observer.disconnect(); ownedStyle.textContent = '' }
  }, [id, testId, emptySlots, known, active, dragging, root, scope])
  return <style ref={style} data-xp-outline={id} />
}

function ExperimentOutline({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const scope = useId()
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
  const rules = useMemo(() => (JSON.parse(key) as OutlineItem[]).map(item => <SlotRules key={item[0]} item={item} root={root} scope={scope} />), [key, scope])
  return <div ref={root} data-xp-outline-scope={scope} style={{ display: 'contents' }}>{children}{rules}</div>
}

/** Add to Puck's plugins so its outline wrapper composes with the host's overrides. */
export function experimentOutlinePlugin(): Plugin {
  return { name: 'experiment-outline', overrides: { outline: ExperimentOutline } }
}

import type { Field } from 'payload'
import { BLOCK_SLOTS, EXPERIMENT_BLOCK_SLUG, isObject, slotBlocks, type ExperimentBlock, type HostBlock } from './model.js'

/** Clone stored row trees on write. Relationships and rich-text nodes without ids stay intact. */
export function freshBlockIds<T>(value: T, mint: () => string = () => globalThis.crypto.randomUUID()): T {
  if (Array.isArray(value)) return value.map(row => {
    if (!isObject(row)) return row
    return { ...freshBlockIds(row, mint), id: mint() }
  }) as T
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, key === 'id' ? mint() : freshBlockIds(v, mint)])) as T
  return value
}
export function wrapExperimentBlock(block: HostBlock, experiment: string, blockSlug = EXPERIMENT_BLOCK_SLUG): ExperimentBlock {
  if (block.blockType === blockSlug) throw new Error('Experiment blocks cannot be nested.')
  return { id: globalThis.crypto.randomUUID(), blockType: blockSlug, experiment, slots: [
    { id: globalThis.crypto.randomUUID(), slot: 'control', blocks: [block] },
    { id: globalThis.crypto.randomUUID(), slot: 'variantA', blocks: freshBlockIds([block]) },
  ] }
}
export function syncExperimentSlots(block: ExperimentBlock, arms: readonly { key: string; kind?: string; slot?: string | null }[]): ExperimentBlock {
  const wanted = arms.filter(a => a.kind !== 'holdout' && a.key !== 'holdout').map(a => a.slot ?? a.key).filter(slot => BLOCK_SLOTS.includes(slot as typeof BLOCK_SLOTS[number]))
  const slots = [...new Set(wanted)].map(slot => block.slots.find(row => row.slot === slot) ?? {
    id: globalThis.crypto.randomUUID(), slot, blocks: freshBlockIds(slotBlocks(block, 'control')),
  })
  return { ...block, slots }
}
export function copyOriginalIntoVersion(block: ExperimentBlock, slot: string): ExperimentBlock {
  return { ...block, slots: block.slots.map(row => row.slot === slot && slot !== 'control'
    ? { ...row, blocks: freshBlockIds(slotBlocks(block, 'control')) } : row) }
}
export function unwrapExperimentBlock(block: HostBlock, slot = 'control'): HostBlock[] {
  return freshBlockIds(slotBlocks(block, slot))
}

/** Config coordinates include unnamed layout containers. No field component is injected here. */
export function findRegisteredBlocksField(fields: readonly Field[], name: string): { field: Extract<Field, { type: 'blocks' }>; path: Array<string | number> } | undefined {
  function visit(fields: readonly Field[], path: Array<string | number>): ReturnType<typeof findRegisteredBlocksField> {
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]!, here = [...path, i]
      if ('name' in field && field.name === name && field.type === 'blocks') return { field, path: here }
      if ('tabs' in field) for (let t = 0; t < field.tabs.length; t++) {
        const found = visit(field.tabs[t]!.fields, [...here, 'tabs', t, 'fields'])
        if (found) return found
      }
      if ('fields' in field) { const found = visit(field.fields, [...here, 'fields']); if (found) return found }
    }
  }
  return visit(fields, [])
}

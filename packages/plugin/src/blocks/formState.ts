import type { Block, Field, SanitizedConfig } from 'payload'
import { BLOCK_SLOTS, EXPERIMENT_BLOCK_SLUG, isObject, slotBlocks, type ExperimentBlock, type HostBlock } from './model.js'

type RowConfig = { blocks?: Block[]; localization?: SanitizedConfig['localization'] }
type RowsField = Extract<Field, { type: 'array' | 'blocks' }>

/** Mirror Payload 3.90.2's collections/operations/utilities/copyDataWithFreshRowIDs.js:
 * walk configured row/subfield containers only. Mint ids for array/blocks rows, leaving
 * opaque values (including json, richText, relationships and uploads) unchanged.
 * Global block definitions resolve blockReferences; inline slot blocks retain host configs.
 */
export function freshBlockIds<T>(value: T, field: RowsField, config: RowConfig = {}, mint: () => string = () => globalThis.crypto.randomUUID()): T {
  function copyObject(data: Record<string, unknown>, fields: readonly Field[], parentIsLocalized = false): Record<string, unknown> {
    const result = { ...data }
    for (const child of fields) {
      if (child.type === 'row' || child.type === 'collapsible' || child.type === 'group' && !('name' in child && child.name)) {
        Object.assign(result, copyObject(result, child.fields, parentIsLocalized))
      } else if (child.type === 'tabs') {
        for (const tab of child.tabs) {
          if ('name' in tab && tab.name) {
            if (Object.hasOwn(result, tab.name)) result[tab.name] = subfields(result[tab.name], tab.fields, tab.localized, parentIsLocalized)
          }
          else Object.assign(result, copyObject(result, tab.fields, parentIsLocalized))
        }
      } else if (child.type === 'group' && 'name' in child && child.name) {
        if (Object.hasOwn(result, child.name)) result[child.name] = subfields(result[child.name], child.fields, child.localized, parentIsLocalized)
      } else if (child.type === 'array' || child.type === 'blocks') {
        if (Object.hasOwn(result, child.name)) result[child.name] = copyRows(result[child.name], child, parentIsLocalized || Boolean(child.localized))
      }
    }
    return result
  }
  function subfields(data: unknown, fields: readonly Field[], localized: boolean | undefined, parentIsLocalized: boolean): unknown {
    if (!isObject(data)) return data
    const locales = config.localization ? config.localization.localeCodes : []
    if (localized && !parentIsLocalized && Object.keys(data).length > 0 && Object.keys(data).every(key => locales.includes(key))) return Object.fromEntries(Object.entries(data).map(([locale, value]) => [locale, isObject(value) ? copyObject(value, fields, true) : value]))
    return copyObject(data, fields, parentIsLocalized || Boolean(localized))
  }
  function copyRows(data: unknown, rowsField: RowsField, parentIsLocalized = false): unknown {
    if (Array.isArray(data)) return data.map(row => {
      if (!isObject(row)) return row
      const fields = rowsField.type === 'array' ? rowsField.fields
        : (config.blocks?.find(block => block.slug === row.blockType) ?? [...rowsField.blocks, ...(rowsField.blockReferences ?? []).filter((block): block is Block => typeof block !== 'string')].find(block => block.slug === row.blockType))?.fields ?? []
      return { ...copyObject(row, fields, parentIsLocalized), id: mint() }
    })
    if (isObject(data)) return Object.fromEntries(Object.entries(data).map(([locale, rows]) => [locale, Array.isArray(rows) ? copyRows(rows, rowsField, true) : rows]))
    return data
  }
  return copyRows(value, field) as T
}
export function wrapExperimentBlock(block: HostBlock, experiment: string, field: RowsField, config: RowConfig = {}, blockSlug = EXPERIMENT_BLOCK_SLUG): ExperimentBlock {
  if (block.blockType === blockSlug) throw new Error('Experiment blocks cannot be nested.')
  return { id: globalThis.crypto.randomUUID(), blockType: blockSlug, experiment, slots: [
    { id: globalThis.crypto.randomUUID(), slot: 'control', blocks: [block] },
    { id: globalThis.crypto.randomUUID(), slot: 'variantA', blocks: freshBlockIds([block], field, config) },
  ] }
}
function copySlotBlocks(block: HostBlock, slot: string, field: RowsField, config: RowConfig): HostBlock[] {
  // Traverse the wrapper too: slot content may use blocks defined only inside
  // createExperimentBlock, rather than in the host's outer blocks field.
  return slotBlocks(freshBlockIds([block], field, config)[0]!, slot)
}
export function syncExperimentSlots(block: ExperimentBlock, arms: readonly { key: string; kind?: string; slot?: string | null }[], field: RowsField, config: RowConfig = {}): ExperimentBlock {
  const wanted = arms.filter(a => a.kind !== 'holdout' && a.key !== 'holdout').map(a => a.slot ?? a.key).filter(slot => BLOCK_SLOTS.includes(slot as typeof BLOCK_SLOTS[number]))
  const slots = [...new Set(wanted)].map(slot => block.slots.find(row => row.slot === slot) ?? {
    id: globalThis.crypto.randomUUID(), slot, blocks: copySlotBlocks(block, 'control', field, config),
  })
  return { ...block, slots }
}
export function copyOriginalIntoVersion(block: ExperimentBlock, slot: string, field: RowsField, config: RowConfig = {}): ExperimentBlock {
  return { ...block, slots: block.slots.map(row => row.slot === slot && slot !== 'control'
    ? { ...row, blocks: copySlotBlocks(block, 'control', field, config) } : row) }
}
export function unwrapExperimentBlock(block: HostBlock, field: RowsField, slot = 'control', config: RowConfig = {}): HostBlock[] {
  return copySlotBlocks(block, slot, field, config)
}

/** Config coordinates include unnamed layout containers. No field component is injected here. */
export function findRegisteredBlocksField(fields: readonly Field[], name: string): { field: Extract<Field, { type: 'blocks' }>; path: Array<string | number> } | undefined {
  function visit(fields: readonly Field[], path: Array<string | number>): ReturnType<typeof findRegisteredBlocksField> {
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]!, here = [...path, i]
      if ('name' in field && field.name === name && field.type === 'blocks') return { field, path: here }
      if (field.type === 'tabs') for (let t = 0; t < field.tabs.length; t++) {
        const tab = field.tabs[t]!
        if ('name' in tab && tab.name) continue
        const found = visit(field.tabs[t]!.fields, [...here, 'tabs', t, 'fields'])
        if (found) return found
      }
      if (field.type === 'row' || field.type === 'collapsible') { const found = visit(field.fields, [...here, 'fields']); if (found) return found }
    }
  }
  return visit(fields, [])
}

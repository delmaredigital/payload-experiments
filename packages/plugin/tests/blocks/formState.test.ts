import { expect, test } from 'vitest'
import { createExperimentBlock, validateExperimentSlots } from '../../src/blocks/createExperimentBlock.js'
import { copyOriginalIntoVersion, freshBlockIds, findRegisteredBlocksField, syncExperimentSlots, unwrapExperimentBlock, wrapExperimentBlock } from '../../src/blocks/formState.js'
import type { Block, Field } from 'payload'
const hostConfigs: Block[] = [{ slug: 'text', fields: [{ name: 'rows', type: 'array', fields: [{ name: 'text', type: 'text' }] }] }]
const field: Extract<Field, { type: 'blocks' }> = { name: 'layout', type: 'blocks', blocks: [...hostConfigs, createExperimentBlock({ blocks: hostConfigs })] }
const text = { id: 'source', blockType: 'text', rows: [{ id: 'nested', text: 'Same' }] }
test('factory passes host configs through unmodified and validates row uniqueness without a unique index', () => {
  const blocks: Block[] = [{ slug: 'text', fields: [{ name: 'text', type: 'text' }] }]
  const wrapper = createExperimentBlock({ blocks })
  const slots = wrapper.fields[2] as Extract<Field, { type: 'array' }>
  expect(slots.unique).toBeUndefined()
  expect((slots.fields[2] as Extract<Field, { type: 'blocks' }>).blocks).toBe(blocks)
  expect(slots.validate).toBe(validateExperimentSlots)
  expect(validateExperimentSlots([{ slot: 'control' }, { slot: 'control' }])).toBe('Each version appears once')
  expect(validateExperimentSlots([{ slot: 'control' }, { slot: 'variantA' }])).toBe(true)
  expect(() => createExperimentBlock({ blocks: [wrapper] })).toThrow('nested')
})
test('wrap, sync, copy and unwrap make fresh ids on every nested row without mutating source', () => {
  const block = wrapExperimentBlock(text, 'hero', field)
  expect(block.slots[0]?.blocks[0]).toBe(text)
  expect(block.slots[1]?.blocks[0]?.id).not.toBe(text.id)
  expect((block.slots[1]?.blocks[0]?.rows as Array<{ id: string }>)[0]?.id).not.toBe('nested')
  const synced = syncExperimentSlots(block, [{ key: 'control' }, { key: 'variantB' }, { key: 'holdout', kind: 'holdout' }], field)
  expect(synced.slots.map(row => row.slot)).toEqual(['control', 'variantB'])
  expect(synced.slots[1]?.blocks[0]?.id).not.toBe(text.id)
  const copied = copyOriginalIntoVersion(synced, 'variantB', field)
  expect(copied.slots[1]?.blocks[0]?.id).not.toBe(synced.slots[1]?.blocks[0]?.id)
  expect(unwrapExperimentBlock(block, field)[0]?.id).not.toBe(text.id)
  expect(text.rows[0]?.id).toBe('nested')
})
test('registered field config path traverses unnamed tabs, rows and collapsibles', () => {
  const field: Field = { name: 'layout', type: 'blocks', blocks: [] }
  const found = findRegisteredBlocksField([{ type: 'tabs', tabs: [{ label: 'Content', fields: [{ type: 'row', fields: [{ type: 'collapsible', label: 'Layout', fields: [field] }] }] }] }], 'layout')
  expect(found).toEqual({ field, path: [0, 'tabs', 0, 'fields', 0, 'fields', 0, 'fields', 0] })
  expect(findRegisteredBlocksField([], 'missing')).toBeUndefined()
})

// Measured below 100 ms locally; each cap leaves CI headroom.
test('factory uses editor-facing labels without changing the block admin', () => {
  const block = createExperimentBlock({ blocks: [] })
  expect(block.labels).toEqual({ singular: 'Experiment', plural: 'Experiments' })
  expect(block.admin).toBeUndefined()
  expect(block.fields[1]).toMatchObject({ label: 'Test' })
  const slots = block.fields[2] as Extract<Field, { type: 'array' }>
  expect(slots.label).toBe('Versions')
  expect(slots.fields[1]).toMatchObject({ label: 'Version', options: [
    { label: 'Original', value: 'control' }, { label: 'Variant A', value: 'variantA' },
    { label: 'Variant B', value: 'variantB' }, { label: 'Variant C', value: 'variantC' },
  ] })
  expect(slots.fields[2]).toMatchObject({ label: 'Content' })
}, 5000)

test('fresh row ids follow named and unnamed containers and global block references only', () => {
  const config: Field = { name: 'layout', type: 'blocks', blocks: [], blockReferences: ['content'] }
  const rowFields: Field[] = [{ name: 'items', type: 'array', fields: [{ name: 'value', type: 'json' }] }]
  const blocks: Block[] = [{ slug: 'content', fields: [
    { type: 'row', fields: [{ type: 'collapsible', label: 'Content', fields: [
      { type: 'group', name: 'group', fields: rowFields },
      { type: 'tabs', tabs: [{ label: 'Flat', fields: rowFields }, { name: 'named', label: 'Named', fields: rowFields }] },
    ] }] },
  ] }]
  const items = [{ id: 'old', value: [{ id: 'opaque' }] }]
  const source = [{ id: 'block', blockType: 'content', group: { items }, items, named: { items } }]
  let sequence = 0
  const copied = freshBlockIds(source, config, { blocks }, () => `new-${++sequence}`)
  expect(copied[0]!.id).not.toBe('block')
  for (const list of [copied[0]!.items, copied[0]!.group.items, copied[0]!.named.items]) {
    expect(list[0]!.id).not.toBe('old')
    expect(list[0]!.value).toEqual([{ id: 'opaque' }])
  }
  expect(source[0]!.id).toBe('block')
}, 5000)

test.each([
  { name: 'group', type: 'group', fields: [field] },
  { name: 'sections', type: 'array', fields: [field] },
  { type: 'tabs', tabs: [{ name: 'content', label: 'Content', fields: [field] }] },
] satisfies Field[])('registered field ignores named container $type', container => {
  expect(findRegisteredBlocksField([container], 'layout')).toBeUndefined()
}, 5000)

import { expect, test } from 'vitest'
import { createExperimentBlock, validateExperimentSlots } from '../../src/blocks/createExperimentBlock.js'
import { copyOriginalIntoVersion, findRegisteredBlocksField, syncExperimentSlots, unwrapExperimentBlock, wrapExperimentBlock } from '../../src/blocks/formState.js'
import type { Block, Field } from 'payload'
const text = { id: 'source', blockType: 'text', rows: [{ id: 'nested', text: 'Same' }] }
test('factory passes host configs through unmodified and validates row uniqueness without a unique index', () => {
  const blocks: Block[] = [{ slug: 'text', fields: [{ name: 'text', type: 'text' }] }]
  const wrapper = createExperimentBlock({ blocks })
  const slots = wrapper.fields[1] as Extract<Field, { type: 'array' }>
  expect(slots.unique).toBeUndefined()
  expect((slots.fields[1] as Extract<Field, { type: 'blocks' }>).blocks).toBe(blocks)
  expect(slots.validate).toBe(validateExperimentSlots)
  expect(validateExperimentSlots([{ slot: 'control' }, { slot: 'control' }])).toBe('Each version appears once')
  expect(validateExperimentSlots([{ slot: 'control' }, { slot: 'variantA' }])).toBe(true)
  expect(() => createExperimentBlock({ blocks: [wrapper] })).toThrow('nested')
})
test('wrap, sync, copy and unwrap make fresh ids on every nested row without mutating source', () => {
  const block = wrapExperimentBlock(text, 'hero')
  expect(block.slots[0]?.blocks[0]).toBe(text)
  expect(block.slots[1]?.blocks[0]?.id).not.toBe(text.id)
  expect((block.slots[1]?.blocks[0]?.rows as Array<{ id: string }>)[0]?.id).not.toBe('nested')
  const synced = syncExperimentSlots(block, [{ key: 'control' }, { key: 'variantB' }, { key: 'holdout', kind: 'holdout' }])
  expect(synced.slots.map(row => row.slot)).toEqual(['control', 'variantB'])
  expect(synced.slots[1]?.blocks[0]?.id).not.toBe(text.id)
  const copied = copyOriginalIntoVersion(synced, 'variantB')
  expect(copied.slots[1]?.blocks[0]?.id).not.toBe(synced.slots[1]?.blocks[0]?.id)
  expect(unwrapExperimentBlock(block)[0]?.id).not.toBe(text.id)
  expect(text.rows[0]?.id).toBe('nested')
})
test('registered field config path traverses unnamed tabs, rows and collapsibles', () => {
  const field: Field = { name: 'layout', type: 'blocks', blocks: [] }
  const found = findRegisteredBlocksField([{ type: 'tabs', tabs: [{ label: 'Content', fields: [{ type: 'row', fields: [{ type: 'collapsible', label: 'Layout', fields: [field] }] }] }] }], 'layout')
  expect(found).toEqual({ field, path: [0, 'tabs', 0, 'fields', 0, 'fields', 0, 'fields', 0] })
  expect(findRegisteredBlocksField([], 'missing')).toBeUndefined()
})

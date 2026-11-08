import { expect, test } from 'vitest'
import type { Config, Field } from 'payload'
import { createExperimentsPlugin } from '../../../src/plugin.js'
import { findRegisteredBlocksField } from '../../../src/blocks/formState.js'
import { XP_TEST_BLOCK } from '../../../src/admin/paths.js'
import { sampleOptions } from '../../collections/fixtures.js'
import { field } from './fixtures.js'
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
function apply(fields: Field[], appliesTo: (data: Record<string, unknown>) => boolean = () => true, blocks = true) {
  return createExperimentsPlugin({ ...sampleOptions(), access: { manage: () => true }, puck: { enabled: true, collections: [{ slug: 'pages', field: 'puck' }] },
    ...(blocks ? { blocks: { collections: [{ slug: 'pages', field: 'layout', appliesTo }] } } : {}),
  })({ collections: [{ slug: 'pages', fields }] } as Config) as Config
}
test.each(['tab', 'row', 'collapsible'])('injects immediately after registered field in %s without mutating shared nested arrays', layout => {
  const inner: Field[] = [field, { name: 'footer', type: 'text' }]
  const fields: Field[] = layout === 'tab' ? [{ type: 'tabs', tabs: [{ label: 'Content', fields: inner }] }]
    : layout === 'row' ? [{ type: 'row', fields: inner }] : [{ type: 'collapsible', label: 'Content', fields: inner }]
  freeze(fields)
  const result = apply(fields, data => data.editor === 'blocks')
  const registered = findRegisteredBlocksField(result.collections!.find(c => c.slug === 'pages')!.fields, 'layout')!
  const parentPath = registered.path.slice(0, -1)
  const parent = parentPath.reduce<any>((data, key) => data[key], result.collections!.find(c => c.slug === 'pages')!.fields)
  expect(parent.map((item: any) => item.name)).toEqual(['layout', 'xpTestBlock', 'footer'])
  expect(inner.map(item => 'name' in item ? item.name : '')).toEqual(['layout', 'footer'])
  const ui = parent[1]
  expect(ui.admin.components.Field.path).toBe(XP_TEST_BLOCK)
  expect(ui.admin.condition({ editor: 'blocks' })).toBe(true)
  expect(ui.admin.condition({ editor: 'puck' })).toBe(false)
  expect(ui.admin.condition({})).toBe(false)
})
test('throwing appliesTo returns false for partial create data', () => {
  const result = apply([field], () => { throw new Error('partial') })
  expect((result.collections!.find(c => c.slug === 'pages')!.fields[1] as any).admin.condition({})).toBe(false)
})
test('Puck-only collection has no test-block field', () => {
  expect(apply([field], undefined, false).collections!.find(c => c.slug === 'pages')!.fields).toEqual([field])
})

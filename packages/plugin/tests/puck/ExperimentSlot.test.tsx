import { renderToString } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { ArmSlot } from '../../src/types/puck.js'
import { ExperimentSlot } from '../../src/puck/ExperimentSlot.js'
import { createExperimentSlotField } from '../../src/puck/experimentSlotField.js'
import { ExperimentPicker } from '../../src/puck/ExperimentPicker.js'
import { slotLabels } from '../../src/puck/copy.js'
import { GROUP_LABELS } from '../../src/admin/copy/arms.js'

type RenderProps = Parameters<typeof ExperimentSlot.render>[0]
const names: ArmSlot[] = ['control', 'variantA', 'variantB', 'variantC']

function renderProps(overrides: Partial<RenderProps> = {}) {
  const slots = {
    control: vi.fn(() => <p>Original content</p>),
    variantA: vi.fn(() => <p>A content</p>),
    variantB: vi.fn(() => <p>B content</p>),
    variantC: vi.fn(() => <p>C content</p>),
  }
  const props: RenderProps = {
    ...slots, id: 'slot-1', experiment: { id: 1, slug: 'example' },
    puck: { renderDropZone: () => null, metadata: {}, isEditing: false, dragRef: null },
    ...overrides,
  }
  return { props, slots }
}

test.each(names)('only calls and renders %s, even when every slot contains content', xpSlot => {
  const { props, slots } = renderProps({ xpSlot, xpArm: 'a-different-key' })
  const html = renderToString(ExperimentSlot.render(props))
  const contents = { control: 'Original content', variantA: 'A content', variantB: 'B content', variantC: 'C content' }
  for (const name of names) {
    expect(slots[name]).toHaveBeenCalledTimes(name === xpSlot ? 1 : 0)
    if (name === xpSlot) expect(html).toContain(contents[name])
    else expect(html).not.toContain(contents[name])
  }
})

test.each([undefined, 'unknown' as ArmSlot])('falls back to the Original for xpSlot=%s', xpSlot => {
  const { props, slots } = renderProps({ xpSlot, xpArm: 'variantC', experiment: null })
  expect(renderToString(ExperimentSlot.render(props))).toContain('Original content')
  expect(slots.control).toHaveBeenCalledOnce()
  for (const name of ['variantA', 'variantB', 'variantC'] as const) expect(slots[name]).not.toHaveBeenCalled()
})

test('a viewport exposure renders the fixed wrapper and sentinel markup', () => {
  const { props } = renderProps({ xpSlot: 'variantB' })
  const html = renderToString(ExperimentSlot.render({ ...props, xpExpose: { slug: 'example', arm: 'variantB', phase: 2 } }))
  expect(html).toContain('data-xp-viewport="true"')
  expect(html).toContain('data-xp-sentinel="true"')
  expect(html).toContain('height:100px')
  expect(html).toContain('aria-hidden="true"')
})

test('config defines four slots, a custom experiment field, and empty serialized defaults', () => {
  expect(ExperimentSlot.label).toBe('Experiment')
  expect(Object.keys(ExperimentSlot.fields!)[0]).toBe('experiment')
  expect(ExperimentSlot.fields).toEqual({
    experiment: { type: 'custom', label: 'Experiment', render: expect.any(Function) },
    variantC: { type: 'slot', label: 'Variant C' }, variantB: { type: 'slot', label: 'Variant B' },
    variantA: { type: 'slot', label: 'Variant A' }, control: { type: 'slot', label: 'Original' },
  })
  expect(ExperimentSlot.defaultProps).toEqual({ experiment: null, control: [], variantA: [], variantB: [], variantC: [] })
})

test('Puck slot labels match the admin group labels', () => {
  for (const key of names) expect(slotLabels[key]).toBe(GROUP_LABELS[key])
})

test('custom field supports a label and passes the reference and change callback to the picker', () => {
  const field = createExperimentSlotField({ label: 'Choose an experiment' })
  expect(field.label).toBe('Choose an experiment')
  const value = { id: 'uuid-1', slug: 'example' }
  const onChange = vi.fn()
  const element = field.render({ field, name: 'experiment', id: 'experiment-1', value, onChange })
  expect(element.type).toBe(ExperimentPicker)
  expect(element.props).toEqual({ value, onChange })
})

test('without xpExpose the slot renders exactly the bare Slot: no wrapper element', () => {
  const { props } = renderProps({ xpSlot: 'variantA', xpArm: 'variantA' })
  const html = renderToString(ExperimentSlot.render(props))
  expect(html).toBe(renderToString(<p>A content</p>))
  expect(html).not.toContain('data-xp-viewport')
})

test('with a viewport exposure the slot keeps its fixed-geometry wrapper', () => {
  const { props } = renderProps({ xpSlot: 'variantA', xpArm: 'variantA', xpExpose: { slug: 'example', arm: 'variantA', phase: 1 } })
  const html = renderToString(ExperimentSlot.render(props))
  expect(html).toContain('data-xp-viewport')
  expect(html).toContain('data-xp-sentinel')
  expect(html).toContain('A content')
})

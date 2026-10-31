import { renderToString } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { ArmSlot } from '../../src/types/puck.js'
import { ExperimentSlot } from '../../src/puck/ExperimentSlot.js'
import { createExperimentSlotField } from '../../src/puck/experimentSlotField.js'
import { ExperimentPicker } from '../../src/puck/ExperimentPicker.js'

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

test('always renders byte-identical wrapper and fixed sentinel markup with or without exposure', () => {
  const { props } = renderProps({ xpSlot: 'variantB' })
  const html = renderToString(ExperimentSlot.render(props))
  expect(renderToString(ExperimentSlot.render({ ...props, xpExpose: { slug: 'example', arm: 'variantB', phase: 2 } }))).toBe(html)
  expect(html).toContain('data-xp-viewport="true"')
  expect(html).toContain('data-xp-sentinel="true"')
  expect(html).toContain('height:100px')
  expect(html).toContain('aria-hidden="true"')
})

test('config defines four slots, a custom experiment field, and empty serialized defaults', () => {
  expect(ExperimentSlot.label).toBe('Experiment')
  expect(ExperimentSlot.fields).toEqual({
    experiment: { type: 'custom', label: 'Experiment', render: expect.any(Function) },
    control: { type: 'slot' }, variantA: { type: 'slot' }, variantB: { type: 'slot' }, variantC: { type: 'slot' },
  })
  expect(ExperimentSlot.defaultProps).toEqual({ experiment: null, control: [], variantA: [], variantB: [], variantC: [] })
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

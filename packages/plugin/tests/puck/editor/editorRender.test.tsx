// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import type { EditorExperiment } from '../../../src/puck/editor/editor.model.js'

const puck = vi.hoisted(() => ({ item: {
  type: 'ExperimentSlot', props: {
    id: 'slot-1', experiment: { id: 1, slug: 'example' },
    control: [{ type: 'Text', props: { id: 'source-id', text: 'Hello', nested: [{ type: 'Text', props: { id: 'nested-id', text: 'Nested' } }] } }],
    variantA: [], variantB: [], variantC: [],
  },
}, dispatch: vi.fn(), getSelectorForId: vi.fn(), selectors: [] as unknown[] }))

vi.mock('@puckeditor/core', async importOriginal => {
  // Puck's drag library references this browser API during module evaluation.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  return {
  ...await importOriginal<typeof import('@puckeditor/core')>(),
  createUsePuck: () => (selector: (state: unknown) => unknown) => {
    const result = selector({ selectedItem: puck.item })
    puck.selectors.push(result)
    return result
  },
  useGetPuck: () => () => ({ selectedItem: puck.item, getItemById: (id: string) => id === puck.item.props.id ? puck.item : undefined, dispatch: puck.dispatch, getSelectorForId: puck.getSelectorForId }),
  }
})

type RenderProps = Parameters<typeof ExperimentSlotEditor.render>[0]
const doc: EditorExperiment = {
  name: 'Example', status: 'running', arms: [
    { key: 'control', label: 'Original', kind: 'control' },
    { key: 'variantA', label: 'New headline', kind: 'variant' },
    { key: 'holdout', label: 'Holdout', kind: 'holdout' },
  ],
}

function props(overrides: Partial<RenderProps> = {}): RenderProps {
  return { id: 'slot-1', experiment: { id: 1, slug: 'example' },
    control: vi.fn(() => <p>Original content</p>), variantA: vi.fn(() => <p>Variant content</p>),
    variantB: vi.fn(() => <p>B content</p>), variantC: vi.fn(() => <p>C content</p>),
    puck: { renderDropZone: () => null, metadata: {}, isEditing: true, dragRef: null },
    ...overrides,
  }
}

beforeEach(() => {
  puck.dispatch.mockReset()
  puck.getSelectorForId.mockReset().mockReturnValue({ index: 2, zone: 'parent:content' })
  puck.selectors.length = 0
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => doc }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('renders only the selected group slot, switches tabs, and has primitive selectors', async () => {
  const input = props()
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...input} />)
  await screen.findByRole('tab', { name: 'New headline' })
  expect(screen.getByRole('status').textContent).toBe('Changing this content mid-test mixes two versions in one result')
  expect(screen.getByText('Original content')).toBeTruthy()
  expect(input.variantA).not.toHaveBeenCalled()
  expect(input.variantB).not.toHaveBeenCalled()
  expect(input.variantC).not.toHaveBeenCalled()
  expect(screen.queryByRole('tab', { name: 'Holdout' })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'New headline' }))
  expect(screen.getByText('Variant content')).toBeTruthy()
  expect(screen.queryByText('Original content')).toBeNull()
  expect(screen.getByRole('tab', { name: 'New headline' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tab', { name: 'New headline' }).closest('[data-puck-overlay-portal]')).toBeTruthy()
  expect(screen.getByRole('tabpanel').closest('[data-puck-overlay-portal]')).toBeNull()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'New headline' }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'Original' }).getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Original' }))
  expect(puck.selectors.every(value => typeof value === 'boolean')).toBe(true)
  expect(fetch).toHaveBeenCalledWith('/api/xp-experiments/1?depth=0', { credentials: 'include', signal: expect.any(AbortSignal) })
})

test('copy replaces the selected item at its actual zone with independently editable content', async () => {
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Copy Original → New headline' }))
  expect(puck.getSelectorForId).toHaveBeenCalledWith('slot-1')
  expect(puck.dispatch).toHaveBeenCalledOnce()
  const action = puck.dispatch.mock.calls[0]![0]
  expect(action).toMatchObject({ type: 'replace', destinationIndex: 2, destinationZone: 'parent:content', data: {
    type: 'ExperimentSlot', props: { id: 'slot-1', experiment: { id: 1, slug: 'example' }, control: puck.item.props.control },
  } })
  const copied = action.data.props.variantA
  expect(copied).not.toBe(puck.item.props.control)
  expect(copied[0].props.id).not.toBe('source-id')
  expect(copied[0].props.nested[0].props.id).not.toBe('nested-id')
  expect(copied[0].props.text).toBe('Hello')
  expect(puck.item.props.control[0]!.props.id).toBe('source-id')
})

test('copy is disabled for an empty Original', async () => {
  const original = puck.item.props.control
  puck.item.props.control = []
  try {
    const Editor = ExperimentSlotEditor.render
    render(<Editor {...props()} />)
    const copy = await screen.findByRole('button', { name: 'Copy Original → New headline' })
    expect((copy as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(copy)
    expect(puck.dispatch).not.toHaveBeenCalled()
  } finally { puck.item.props.control = original }
})

test('never creates an observer or sends an exposure, even with xpExpose', async () => {
  const observer = vi.fn(), sendBeacon = vi.fn()
  vi.stubGlobal('IntersectionObserver', observer)
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon })
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props({ xpExpose: { slug: 'example', arm: 'variantA', phase: 1 } })} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
  expect(observer).not.toHaveBeenCalled()
  expect(sendBeacon).not.toHaveBeenCalled()
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/xp/events'))).toBe(false)
})

test('unbound shows Original and create success binds the component experiment prop', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ doc: { id: 'created', slug: 'new-test' } }) } as Response)
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props({ experiment: null })} />)
  expect(screen.getByRole('status').textContent).toBe('Choose or create an experiment to show different versions.')
  expect(screen.getAllByRole('tab')).toHaveLength(1)
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Create experiment' }))
  expect(screen.getByLabelText('Name').closest('[data-puck-overlay-portal]')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New test' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Create experiment' })[1]!)
  await waitFor(() => expect(puck.dispatch).toHaveBeenCalledOnce())
  expect(puck.dispatch.mock.calls[0]![0].data.props.experiment).toEqual({ id: 'created', slug: 'new-test' })
})

test('new binding hides stale tabs, resets selection, and aborts the old load', async () => {
  const Editor = ExperimentSlotEditor.render
  const view = render(<Editor {...props()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
  view.rerender(<Editor {...props({ experiment: { id: 2, slug: 'other' } })} />)
  expect(signal.aborted).toBe(true)
  expect(screen.queryByRole('tab', { name: 'New headline' })).toBeNull()
  expect(screen.getByText('Original content')).toBeTruthy()
})

test('load errors retain Original and show a readable message', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('offline'))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Couldn't load this experiment. Try selecting it again."))
  expect(screen.getByText('Original content')).toBeTruthy()
})

test('decided banner uses the stored winner label', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status: 'decided', decision: { winnerArm: 'variantA' } }) } as Response)
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Decided: New headline. Use 'Make it the content' on the experiment to finish."))
})

test('copy into a variant that already has content asks first and only replaces after confirmation', async () => {
  const original = puck.item.props.variantA
  puck.item.props.variantA = [{ type: 'Text', props: { id: 'kept-id', text: 'Existing variant' } }] as never
  try {
    const Editor = ExperimentSlotEditor.render
    render(<Editor {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy Original → New headline' }))
    expect(puck.dispatch).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('New headline already has content.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(puck.dispatch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Original → New headline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(puck.dispatch).toHaveBeenCalledTimes(1)
  } finally { puck.item.props.variantA = original }
})

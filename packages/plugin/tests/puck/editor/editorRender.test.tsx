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
}, dispatch: vi.fn(), getSelectorForId: vi.fn(), selectors: [] as unknown[], title: 'Welcome page', selected: true }))

vi.mock('@puckeditor/core', async importOriginal => {
  // Puck's drag library references this browser API during module evaluation.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  return {
  ...await importOriginal<typeof import('@puckeditor/core')>(),
  createUsePuck: () => (selector: (state: unknown) => unknown) => {
    const result = selector({ selectedItem: puck.selected ? puck.item : null, getItemById: (id: string) => id === puck.item.props.id ? puck.item : undefined, appState: { data: { root: { props: { title: puck.title } } } } })
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
  puck.selected = true
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
  expect(puck.selectors.every(value => typeof value === 'boolean' || typeof value === 'string')).toBe(true)
  expect(fetch).toHaveBeenCalledWith('/api/xp-experiments/1?depth=0', { credentials: 'include', signal: expect.any(AbortSignal) })
})

test('copy replaces the selected item at its actual zone with independently editable content', async () => {
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
  fireEvent.click(screen.getByRole('button', { name: 'Copy Original to this version' }))
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
    fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
    const copy = screen.getByRole('button', { name: 'Copy Original to this version' })
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
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ docs: [] }))).mockResolvedValueOnce(new Response(JSON.stringify({ doc: { id: 'created', slug: 'new-test' } })))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props({ experiment: null })} />)
  expect(screen.getByRole('status').textContent).toBe('Choose or create a test to show different versions.')
  expect(screen.getAllByRole('tab')).toHaveLength(1)
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Test this block' }))
  expect(screen.getByLabelText('Name').closest('[data-puck-overlay-portal]')).toBeTruthy()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Welcome page')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New test' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Test this block' })[1]!)
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
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Couldn't load this test. Try selecting it again."))
  expect(screen.getByText('Original content')).toBeTruthy()
})

test('decided banner uses the stored winner label', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status: 'decided', decision: { winnerArm: 'variantA' } }) } as Response)
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Decided: New headline. Use 'Make it the content' on the test to finish."))
})

test('copy into a variant that already has content asks first and only replaces after confirmation', async () => {
  const original = puck.item.props.variantA
  puck.item.props.variantA = [{ type: 'Text', props: { id: 'kept-id', text: 'Existing variant' } }] as never
  try {
    const Editor = ExperimentSlotEditor.render
    render(<Editor {...props()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Original to this version' }))
    expect(puck.dispatch).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('New headline already has content.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(puck.dispatch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Original to this version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(puck.dispatch).toHaveBeenCalledTimes(1)
  } finally { puck.item.props.variantA = original }
})

test('tabs link to their panel, use roving focus, and support arrows, Home and End', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...doc, arms: [
    ...doc.arms, { key: 'variantB', label: 'Variant B', kind: 'variant' },
  ] })))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  const last = await screen.findByRole('tab', { name: 'Variant B' })
  const original = screen.getByRole('tab', { name: 'Original' })
  const middle = screen.getByRole('tab', { name: 'New headline' })
  expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('Test versions')
  for (const [key, from, to] of [
    ['End', original, last], ['Home', last, original], ['ArrowLeft', original, last],
    ['ArrowRight', last, original], ['ArrowRight', original, middle], ['ArrowLeft', middle, original],
  ] as const) {
    fireEvent.keyDown(from, { key })
    expect(document.activeElement).toBe(to)
    expect(to.getAttribute('aria-selected')).toBe('true')
    expect(to.tabIndex).toBe(0)
    expect(screen.getAllByRole('tab').filter(tab => tab.tabIndex === 0)).toHaveLength(1)
    const panel = screen.getByRole('tabpanel')
    expect(to.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(to.id)
  }
})

test('empty slots have a labelled frame and filled slots have neither, even when unselected', async () => {
  const Editor = ExperimentSlotEditor.render
  const view = render(<Editor {...props()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
  expect(screen.getByText('Drop Variant A content here')).toBeTruthy()
  expect(screen.getByRole('tabpanel').classList.contains('xp-slot-panel-empty')).toBe(true)
  fireEvent.click(screen.getByRole('tab', { name: 'Original' }))
  expect(screen.queryByText('Drop the original content here')).toBeNull()
  expect(screen.getByRole('tabpanel').classList.contains('xp-slot-panel-empty')).toBe(false)
  puck.selected = false
  view.rerender(<Editor {...props()} />)
  expect(screen.getByRole('tabpanel').classList.contains('xp-slot-panel-empty')).toBe(false)
  const control = puck.item.props.control
  puck.item.props.control = []
  try {
    view.rerender(<Editor {...props()} />)
    expect(screen.getByText('Drop the original content here')).toBeTruthy()
  } finally { puck.item.props.control = control }
})

test.each(['draft', 'stopped', 'running', 'decided', 'archived'] as const)('only running gets the warning banner: %s', async status => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...doc, status })))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await screen.findByRole('tab', { name: 'New headline' })
  expect(screen.getByRole('heading', { name: 'Example' })).toBeTruthy()
  const banner = screen.getByRole('status')
  expect(banner.classList.contains('xp-slot-warning')).toBe(status === 'running')
  expect(Boolean(banner.querySelector('svg[aria-hidden="true"]'))).toBe(status === 'running')
})

test('only the selected variant has a copy action', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...doc, arms: [
    ...doc.arms, { key: 'variantB', label: 'Variant B', kind: 'variant' },
  ] })))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await screen.findByRole('tab', { name: 'Variant B' })
  expect(screen.queryByRole('button', { name: 'Copy Original to this version' })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Variant B' }))
  expect(screen.getAllByRole('button', { name: 'Copy Original to this version' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Copy Original to this version' }))
  expect(puck.dispatch.mock.calls[0]![0].data.props.variantB[0].props.text).toBe('Hello')
})

test('a draft binding links to setup, while a running binding has no setup link', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...doc, status: 'draft' })))
  const Editor = ExperimentSlotEditor.render
  const view = render(<Editor {...props()} />)
  expect((await screen.findByRole('link', { name: 'Set up the test' })).getAttribute('href')).toBe('/admin/experiments/1')
  view.rerender(<Editor {...props({ experiment: { id: 2, slug: 'running' } })} />)
  await screen.findByRole('tab', { name: 'New headline' })
  expect(screen.queryByRole('link', { name: 'Set up the test' })).toBeNull()
})

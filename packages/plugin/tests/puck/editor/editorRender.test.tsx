// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ExperimentSlotEditor, createExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
// These rendering/selection scenarios use a known manager. Access loading and
// denial use the real hook in permissions.test.tsx.
vi.mock('../../../src/puck/editor/editorSurface.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/puck/editor/editorSurface.js')>(),
  useEditorSurface: () => ({ surface: { canManage: true, canReadResults: true } }),
}))
import type { EditorExperiment } from '../../../src/puck/editor/editor.model.js'

const puck = vi.hoisted(() => ({ item: {
  type: 'ExperimentSlot', props: {
    id: 'slot-1', experiment: { id: 1, slug: 'example' },
    control: [{ type: 'Text', props: { id: 'source-id', text: 'Hello', nested: [{ type: 'Text', props: { id: 'nested-id', text: 'Nested' } }] } }],
    variantA: [], variantB: [], variantC: [],
  },
}, dispatch: vi.fn(), getSelectorForId: vi.fn(), selectors: [] as unknown[], title: 'Welcome page', dragging: false, selected: true as boolean | 'other' }))

function selectedItem() {
  return puck.selected === 'other' ? { type: 'Text', props: { id: 'other-block', control: [], variantA: [] } } : puck.selected ? puck.item : null
}

vi.mock('@puckeditor/core', async importOriginal => {
  // Puck's drag library references this browser API during module evaluation.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  return {
  ...await importOriginal<typeof import('@puckeditor/core')>(),
  createUsePuck: () => (selector: (state: unknown) => unknown) => {
    const result = selector({ selectedItem: selectedItem(), getItemById: (id: string) => id === puck.item.props.id ? puck.item : undefined, config: { components: {} }, appState: { data: { root: { props: { title: puck.title } }, content: [] } } })
    puck.selectors.push(result)
    return result
  },
  useGetPuck: () => () => ({ appState: { data: { root: { props: {} }, content: [puck.item] }, ui: { isDragging: puck.dragging } }, config: { components: {} }, selectedItem: selectedItem(), getItemById: (id: string) => id === puck.item.props.id ? puck.item : undefined, dispatch: puck.dispatch, getSelectorForId: puck.getSelectorForId }),
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
  if ('experiment' in overrides) puck.item.props.experiment = overrides.experiment as never
  return { id: 'slot-1', experiment: { id: 1, slug: 'example' },
    control: vi.fn(() => <p>Original content</p>), variantA: vi.fn(() => <p>Variant content</p>),
    variantB: vi.fn(() => <p>B content</p>), variantC: vi.fn(() => <p>C content</p>),
    puck: { renderDropZone: () => null, metadata: {}, isEditing: true, dragRef: null },
    ...overrides,
  }
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  puck.item.props.experiment = { id: 1, slug: 'example' }
  puck.dispatch.mockReset()
  puck.getSelectorForId.mockReset().mockReturnValue({ index: 2, zone: 'parent:content' })
  puck.selectors.length = 0
  puck.dragging = false
  puck.selected = true
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => doc }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test.each([false, 'other'] as const)('clicking non-interactive chrome selects this block with selection %s', async selection => {
  puck.selected = selection
  const Editor = ExperimentSlotEditor.render
  const view = render(<Editor {...props()} />)
  const title = await screen.findByRole('heading', { name: 'Example' })
  const chrome = title.closest<HTMLElement>('.xp-slot-chrome')!
  expect(chrome.dataset.selected).toBe('false')
  for (const target of [title.closest('header')!, title, screen.getByText('Running'), chrome, screen.getByText('Changing this content mid-test mixes two versions in one result')]) {
    puck.dispatch.mockClear()
    fireEvent.click(target)
    expect(puck.getSelectorForId).toHaveBeenLastCalledWith('slot-1')
    expect(puck.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'setUi', ui: { itemSelector: { index: 2, zone: 'parent:content' } } })
  }
  puck.dragging = false
  puck.selected = true
  view.rerender(<Editor {...props()} />)
  expect(chrome.dataset.selected).toBe('true')
  // Content and the handle remain outside the registered no-drag chrome.
  expect(chrome.hasAttribute('data-puck-overlay-portal')).toBe(true)
  expect(screen.getByText('Original content').closest('[data-puck-overlay-portal]')).toBeNull()
})

test.each(['Enter', ' '])('focused chrome selects this block with %j and ignores other keys', key => {
  puck.selected = false
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props({ experiment: null })} />)
  const chrome = screen.getByLabelText('Select this test block')
  chrome.focus()
  expect(document.activeElement).toBe(chrome)
  expect(fireEvent.keyDown(chrome, { key })).toBe(false)
  expect(puck.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'setUi', ui: { itemSelector: { index: 2, zone: 'parent:content' } } })
  puck.dispatch.mockClear()
  fireEvent.keyDown(chrome, { key: 'ArrowRight' })
  expect(puck.dispatch).not.toHaveBeenCalled()
})

test('missing selectors do not dispatch selection and native chrome controls keep their events', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status: 'draft' }) } as Response)
  puck.selected = 'other'
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  const title = await screen.findByRole('heading', { name: 'Example' })
  puck.getSelectorForId.mockReturnValue(undefined)
  fireEvent.click(title)
  expect(puck.dispatch).not.toHaveBeenCalled()
  puck.getSelectorForId.mockReturnValue({ index: 2, zone: 'parent:content' })
  const link = screen.getByLabelText('Original traffic (%)')
  const open = vi.fn((event: MouseEvent) => event.preventDefault())
  link.addEventListener('click', open)
  fireEvent.click(link)
  expect(open).toHaveBeenCalledOnce()
  const input = screen.getByLabelText('Original traffic (%)')
  fireEvent.click(input)
  fireEvent.keyDown(input, { key: ' ' })
  expect(puck.dispatch).not.toHaveBeenCalled()
})

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

test.each(['running', 'draft'].flatMap(status => [false, 'other'].map(selection => ({ status, selection }))))('$status: copy replaces this block at its actual zone with selection $selection', async ({ status, selection }) => {
  puck.selected = selection as false | 'other'
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status }) } as Response)
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
  fireEvent.click(screen.getByRole('button', { name: 'Options for New headline' }))
  fireEvent.click(screen.getByRole('button', { name: 'Copy Original here' }))
  expect(puck.getSelectorForId).toHaveBeenCalledWith('slot-1')
  await waitFor(() => expect(puck.dispatch).toHaveBeenCalledOnce())
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

test.each(['running', 'draft'] as const)('%s: copy is disabled for an empty Original', async status => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status }) } as Response)
  const original = puck.item.props.control
  puck.item.props.control = []
  try {
    const Editor = ExperimentSlotEditor.render
    render(<Editor {...props()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Options for New headline' }))
    const copy = screen.getByRole('button', { name: 'Copy Original here' })
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

test.each([false, 'other'] as const)('unbound create binds this block with selection %s without swallowing or double-firing the button', async selection => {
  puck.selected = selection
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ docs: [] }))).mockResolvedValueOnce(new Response(JSON.stringify({ doc: { id: 'created', slug: 'new-test' } })))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props({ experiment: null })} />)
  expect(screen.getByRole('status').textContent).toBe('Choose or create a test to show different versions.')
  expect(screen.getAllByRole('tab')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Test this block' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(puck.dispatch).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Name').closest('[data-puck-preview]')).toBeNull()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Welcome page')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New test' } })
  fireEvent.keyDown(screen.getByLabelText('Name'), { key: ' ' })
  expect(puck.dispatch).not.toHaveBeenCalled()
  fireEvent.click(screen.getAllByRole('button', { name: 'Test this block' })[1]!)
  await waitFor(() => expect(puck.dispatch).toHaveBeenCalledOnce())
  expect(puck.dispatch.mock.calls[0]![0].data.props.experiment).toEqual({ id: 'created', slug: 'new-test' })
})

test('new binding hides stale tabs, resets selection, and aborts the old load', async () => {
  const Editor = ExperimentSlotEditor.render
  const view = render(<Editor {...props()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  const signal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal!
  view.rerender(<Editor {...props({ experiment: { id: 2, slug: 'other' } })} />)
  expect(signal.aborted).toBe(true)
  expect(screen.queryByRole('tab', { name: 'New headline' })).toBeNull()
  expect(screen.getByText('Original content')).toBeTruthy()
})

test('load errors retain Original and show a readable message', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('offline'))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("Couldn't load this test. Try selecting it again."))
  expect(screen.getByText('Original content')).toBeTruthy()
})

test('decided banner uses the stored winner label', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status: 'decided', decision: { winnerArm: 'variantA' } }) } as Response)
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Decided: New headline. Use 'Make it the content' on the test to finish."))
})

test.each(['running', 'draft'].flatMap(status => [false, 'other'].map(selection => ({ status, selection }))))('$status: copy confirms existing content with selection $selection', async ({ status, selection }) => {
  puck.selected = selection as false | 'other'
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status }) } as Response)
  const original = puck.item.props.variantA
  puck.item.props.variantA = [{ type: 'Text', props: { id: 'kept-id', text: 'Existing variant' } }] as never
  try {
    const Editor = ExperimentSlotEditor.render
    render(<Editor {...props()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Options for New headline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Original here' }))
    expect(puck.dispatch).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('New headline already has content.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(puck.dispatch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Options for New headline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Original here' }))
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
    expect(panel.tabIndex).toBe(0)
    expect(panel.closest('.xp-slot-root')).toBe(screen.getByRole('tablist').closest('.xp-slot-root'))
    expect(panel.closest('.xp-slot-root')).not.toBeNull()
    expect(to.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(to.id)
  }
})

test('empty slots have a labelled frame and filled slots have neither, even when unselected', async () => {
  const Editor = ExperimentSlotEditor.render
  const view = render(<Editor {...props()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
  expect(screen.getByText('Drop Variant A content here')).toBeTruthy()
  expect(screen.getByRole('tabpanel').querySelector('.xp-slot-panel')!.classList.contains('xp-slot-panel-empty')).toBe(true)
  fireEvent.click(screen.getByRole('tab', { name: 'Original' }))
  expect(screen.queryByText('Drop the original content here')).toBeNull()
  expect(screen.getByRole('tabpanel').querySelector('.xp-slot-panel')!.classList.contains('xp-slot-panel-empty')).toBe(false)
  puck.selected = false
  view.rerender(<Editor {...props()} />)
  expect(screen.getByRole('tabpanel').querySelector('.xp-slot-panel')!.classList.contains('xp-slot-panel-empty')).toBe(false)
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
  expect(banner.classList.contains('xp-ui-banner--warning')).toBe(status === 'running')
  expect(banner.classList.contains('xp-ui-banner')).toBe(true)
})

test.each(['running', 'draft'] as const)('%s: only the selected variant has a copy action', async status => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status }) } as Response)
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...doc, status, arms: [
    ...doc.arms, { key: 'variantB', label: 'Variant B', kind: 'variant' },
  ] })))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await screen.findByRole('tab', { name: 'Variant B' })
  expect(screen.queryByRole('button', { name: 'Copy Original here' })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Variant B' }))
  fireEvent.click(screen.getByRole('button', { name: 'Options for Variant B' }))
  expect(screen.getAllByRole('button', { name: 'Copy Original here' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Copy Original here' }))
  expect(puck.dispatch.mock.calls[0]![0].data.props.variantB[0].props.text).toBe('Hello')
})

test.each(['draft', 'running'] as const)('%s binding offers Configure test', async status => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...doc, status })))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await screen.findByRole('heading', { name: 'Example' })
  expect(screen.getByRole('button', { name: 'Configure test' }).classList.contains('xp-ui-button--primary')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Test this block' })).toBeNull()
})

test('binding changes keep Configure test and never offer to create an unbound test', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...doc, status: 'draft' })))
  const Editor = ExperimentSlotEditor.render
  const view = render(<Editor {...props()} />)
  await screen.findByRole('heading', { name: 'Example' })
  view.rerender(<Editor {...props({ experiment: { id: 2, slug: 'running' } })} />)
  await screen.findByRole('tab', { name: 'New headline' })
  expect(screen.getByRole('button', { name: 'Configure test' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Test this block' })).toBeNull()
})

test('unbound header names the registered block and marks it Not set up', () => {
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props({ experiment: null })} />)
  expect(screen.getByRole('heading', { name: 'Experiment block' })).toBeTruthy()
  expect(screen.getByText('Not set up').classList.contains('xp-ui-status')).toBe(true)
  expect(screen.getByRole('button', { name: 'Test this block' }).classList.contains('xp-ui-button--primary')).toBe(true)
})

test.each(['draft', 'running'] as const)('custom routes reach the bound %s fetch', async status => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...doc, status })))
  const Editor = createExperimentSlotEditor({ routes: { api: '/content-api/', admin: '/manage/' } }).render
  render(<Editor {...props({ experiment: { id: 'id/with space', slug: 'example' } })} />)
  await screen.findByRole('heading', { name: 'Example' })
  expect(fetch).toHaveBeenCalledWith('/content-api/xp-experiments/id%2Fwith%20space?depth=0', expect.objectContaining({ credentials: 'include' }))
  expect(screen.getByRole('button', { name: 'Configure test' })).toBeTruthy()
})

test('custom API route reaches both drawer requests', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ docs: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ doc: { id: 'new', slug: 'welcome-page' } })))
  const Editor = createExperimentSlotEditor({ routes: { api: '/content-api/' } }).render
  render(<Editor {...props({ experiment: null })} />)
  fireEvent.click(screen.getByRole('button', { name: 'Test this block' }))
  expect(document.activeElement).toBe(screen.getByLabelText('Name'))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Test this block' }))
  await waitFor(() => expect(puck.dispatch).toHaveBeenCalledOnce())
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url).filter(url => !String(url).endsWith('/xp/editor-surface'))).toEqual([
    expect.stringMatching(/^\/content-api\/xp-experiments\?where\[slug\]\[in\]=welcome-page%2C/), '/content-api/xp-experiments',
  ])
})

test('the drawer opens in the chrome iframe document and focuses its name field', async () => {
  puck.selected = false
  const iframe = document.createElement('iframe')
  document.body.append(iframe)
  const doc = iframe.contentDocument!
  const prototype = Object.getPrototypeOf(doc.createElement('dialog')) as HTMLDialogElement
  prototype.showModal = function () { this.setAttribute('open', '') }
  prototype.close = function () { this.removeAttribute('open') }
  const container = doc.createElement('div')
  doc.body.append(container)
  const Editor = ExperimentSlotEditor.render
  const view = render(<Editor {...props({ experiment: null })} />, { container, baseElement: doc.body })
  try {
    const frame = within(doc.body)
    fireEvent.click(frame.getByRole('heading', { name: 'Experiment block' }))
    expect(puck.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'setUi', ui: { itemSelector: { index: 2, zone: 'parent:content' } } })
    puck.dispatch.mockClear()
    const trigger = frame.getByRole('button', { name: 'Test this block' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(puck.dispatch).not.toHaveBeenCalled()
    const dialog = frame.getByRole('dialog')
    expect(dialog.ownerDocument).toBe(doc)
    expect(doc.querySelector('dialog')).toBe(dialog)
    expect(document.querySelector('dialog')).toBeNull()
    expect(doc.activeElement).toBe(frame.getByLabelText('Name'))
    fireEvent.click(frame.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(frame.queryByRole('dialog')).toBeNull())
    expect(doc.activeElement).toBe(trigger)
  } finally { view.unmount(); iframe.remove() }
})

test.each(['draft', 'running', 'stopped', 'decided', 'archived'] as const)('%s offers the test page, a new test, and removal regardless of selection', async status => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status }) } as Response)
  const Editor = createExperimentSlotEditor({ routes: { admin: '/manage' } }).render
  const view = render(<Editor {...props()} />)
  await screen.findByRole('heading', { name: 'Example' })
  expect(screen.getByRole('button', { name: 'Configure test' }).classList.contains('xp-ui-button--primary')).toBe(true)
  const create = screen.getByRole('button', { name: 'Start a new test from this block' }) as HTMLButtonElement
  expect(create.disabled).toBe(false)
  expect(create.classList.contains('xp-ui-button--secondary')).toBe(true)
  puck.selected = false
  view.rerender(<Editor {...props()} />)
  expect((screen.getByRole('button', { name: create.textContent! }) as HTMLButtonElement).disabled).toBe(false)
  if (status === 'running') {
    expect(screen.queryByRole('button', { name: 'Remove the test from this block' })).toBeNull()
    // A failed optional placement read never guesses that this is the last placement.
    expect(screen.queryByText('Stop the test to remove it from this block.')).toBeNull()
  } else expect((screen.getByRole('button', { name: 'Remove the test from this block' }) as HTMLButtonElement).disabled).toBe(false)
})

test.each([false, 'other'] as const)('creating from a bound block mirrors versions and rebinds only this block with selection %s', async selection => {
  puck.selected = selection
  const oldB = puck.item.props.variantB
  puck.item.props.variantB = [{ type: 'Text', props: { id: 'b-content', text: 'Keep B' } }] as never
  const oldDoc = { ...doc, metrics: { primary: 9 }, targeting: [{ attribute: 'staff', op: 'eq', value: false }],
    decision: { winnerArm: 'variantA' }, arms: [...doc.arms] }
  let created: Record<string, unknown> | undefined
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { created = JSON.parse(String(init.body)); return new Response(JSON.stringify({ doc: { id: 2, slug: 'welcome-page' } })) }
    if (url.includes('where[slug]')) return new Response(JSON.stringify({ docs: [] }))
    if (url.endsWith('/preflight')) return new Response(JSON.stringify({ placements: [] }))
    return new Response(JSON.stringify(url.includes('/xp-experiments/2?') ? { ...created, status: 'draft' } : oldDoc))
  }))
  try {
    const Editor = ExperimentSlotEditor.render
    const view = render(<Editor {...props()} />)
    await screen.findByRole('tab', { name: 'New headline' })
    fireEvent.click(screen.getByRole('button', { name: 'Start a new test from this block' }))
    // Another placement changes the test after this dialog opens.
    oldDoc.arms = oldDoc.arms.map(arm => arm.key === 'variantA' ? { ...arm, label: 'Latest headline' } : arm)
    oldDoc.arms.push({ key: 'variantC', kind: 'variant', label: 'Last idea' })
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('heading').textContent).toBe('Start a new test from this block')
    expect((dialog.getByLabelText('Name') as HTMLInputElement).value).toBe('Welcome page')
    fireEvent.click(dialog.getByRole('button', { name: 'Start a new test from this block' }))
    await waitFor(() => expect(puck.dispatch).toHaveBeenCalledOnce())
    expect(created).toEqual({ name: 'Welcome page', slug: 'welcome-page', kind: 'block', unitType: 'visitor', exposurePolicy: 'render',
      allocation: 100, analysis: { plannedDurationDays: 28 }, arms: [
        { key: 'control', kind: 'control', slot: 'control', label: 'Original', weight: 25 },
        { key: 'variantA', kind: 'variant', slot: 'variantA', label: 'Latest headline', weight: 25 },
        { key: 'variantB', kind: 'variant', slot: 'variantB', label: 'Variant B', weight: 25 },
        { key: 'variantC', kind: 'variant', slot: 'variantC', label: 'Last idea', weight: 25 },
      ] })
    const action = puck.dispatch.mock.calls[0]![0]
    expect(action).toMatchObject({ type: 'replace', destinationIndex: 2, destinationZone: 'parent:content',
      data: { ...puck.item, props: { ...puck.item.props, experiment: { id: 2, slug: 'welcome-page' } } } })
    for (const slot of ['control', 'variantA', 'variantB', 'variantC'] as const) expect(action.data.props[slot]).toBe(puck.item.props[slot])
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')).toHaveLength(1)
    expect(oldDoc.arms).toHaveLength(4)
    view.rerender(<Editor {...props({ experiment: { id: 2, slug: 'welcome-page' } })} />)
    await screen.findByRole('tab', { name: 'Variant B' })
    expect(screen.queryByText(/has content but isn't part/)).toBeNull()
  } finally { puck.item.props.variantB = oldB }
})

test('a refused mirrored test stays in the dialog and leaves the binding and content untouched', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ errors: [{ data: { errors: [{ message: 'Choose valid versions.' }] } }] }), { status: 400 })
    if (url.includes('where[slug]')) return new Response(JSON.stringify({ docs: [] }))
    return new Response(JSON.stringify(doc))
  }))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await screen.findByRole('tab', { name: 'New headline' })
  fireEvent.click(screen.getByRole('button', { name: 'Start a new test from this block' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start a new test from this block' }))
  expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toBe('Choose valid versions.')
  expect(puck.dispatch).not.toHaveBeenCalled()
})

test.each([0, 1, 2])('shared notice uses existing placement read: %s placements', async count => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/preflight')
    ? { placements: Array.from({ length: count }, (_, id) => ({ collection: 'pages', id, detail: 'Published' })) } : doc))))
  const Editor = createExperimentSlotEditor({ routes: { api: '/content-api' } }).render
  render(<Editor {...props()} />)
  await screen.findByRole('tab', { name: 'New headline' })
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/content-api/xp/experiments/1/preflight', expect.objectContaining({ credentials: 'include', cache: 'no-store' })))
  if (count > 0) {
    const notice = await screen.findByText('This test is also used in another place. Changes here affect that test.')
    expect(notice.closest('.xp-ui-banner')?.classList.contains('xp-ui-banner--info')).toBe(true)
    expect(within(notice.closest('.xp-ui-banner') as HTMLElement).getByRole('button', { name: 'Start a new test from this block' })).toBeTruthy()
  } else expect(screen.queryByText('This test is also used in another place. Changes here affect that test.')).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Start a new test from this block' })).toHaveLength(1)
})

test.each([false, 'other'] as const)('removal asks first and clears only this binding with selection %s', async selection => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status: 'draft' }) } as Response)
  vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url).endsWith('/preflight') ? { placements: [] } : { ...doc, status: 'draft' })))
  puck.selected = selection
  const Editor = ExperimentSlotEditor.render
  const view = render(<Editor {...props()} />)
  await screen.findByRole('tab', { name: 'New headline' })
  await act(async () => {})
  const calls = vi.mocked(fetch).mock.calls.length
  const remove = () => fireEvent.click(screen.getByRole('button', { name: 'Remove the test from this block' }))
  remove()
  await screen.findByRole('dialog')
  expect(document.activeElement).toBe(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(puck.dispatch).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(puck.dispatch).not.toHaveBeenCalled()
  remove()
  await screen.findByRole('dialog')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove the test from this block' }))
  await waitFor(() => expect(puck.dispatch).toHaveBeenCalledOnce())
  const action = puck.dispatch.mock.calls[0]![0]
  expect(action.data.props).toEqual({ ...puck.item.props, experiment: null })
  for (const slot of ['control', 'variantA', 'variantB', 'variantC'] as const) expect(action.data.props[slot]).toBe(puck.item.props[slot])
  view.rerender(<Editor {...props({ experiment: null })} />)
  expect(screen.getByRole('button', { name: 'Test this block' })).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  const detachReads = vi.mocked(fetch).mock.calls.slice(calls)
  // Offer, offer after Cancel, and confirmation each recheck the status.
  expect(detachReads.filter(([url]) => String(url).includes('/xp-experiments/'))).toHaveLength(3)
  // Only the successful removal invalidates sharing; drafts need no preflight gate.
  expect(detachReads.filter(([url]) => String(url).endsWith('/preflight'))).toHaveLength(1)
  expect(detachReads).toHaveLength(4)
  expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toContain('/preflight')
})

test('the click that ends a drag cannot dispatch another selection after Puck clears drag state', async () => {
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props({ experiment: null })} />)
  const heading = screen.getByRole('heading', { name: 'Experiment block' })
  fireEvent.pointerDown(heading)
  puck.dragging = true
  fireEvent.pointerMove(heading)
  fireEvent.pointerUp(heading)
  puck.dragging = false
  fireEvent.click(heading)
  expect(puck.dispatch).not.toHaveBeenCalled()
  fireEvent.pointerDown(heading)
  fireEvent.pointerUp(heading)
  fireEvent.click(heading)
  expect(puck.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'setUi', ui: { itemSelector: { index: 2, zone: 'parent:content' } } })
})

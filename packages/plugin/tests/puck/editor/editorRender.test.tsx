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
  FieldGroup: ({ children, label }: { children: import('react').ReactNode; label?: string }) => <div>{label}{children}</div>,
  createUsePuck: () => (selector: (state: unknown) => unknown) => {
    const result = selector({ selectedItem: selectedItem(), getItemById: (id: string) => id === puck.item.props.id ? puck.item : undefined, config: { components: {} }, appState: { data: { root: { props: { title: puck.title } }, content: [] } } })
    puck.selectors.push(result)
    return result
  },
  useGetPuck: () => () => ({ appState: { data: { root: { props: {} }, content: [puck.item] }, ui: { isDragging: puck.dragging } }, config: { components: {} }, selectedItem: selectedItem(), getItemById: (id: string) => id === puck.item.props.id ? puck.item : undefined, dispatch: puck.dispatch, getSelectorForId: puck.getSelectorForId }),
  }
})

vi.mock('../../../src/puck/editor/sidebar.js', () => ({ TestSidebarField: () => null, useSidebarTargets: () => targets }))
let targets: { test: HTMLElement; controls: HTMLElement; onChange: ReturnType<typeof vi.fn> } | undefined
function showSidebar() { targets = { test: document.createElement('div'), controls: document.createElement('div'), onChange: vi.fn() }; document.body.append(targets.test, targets.controls) }
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
  targets = undefined
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  puck.item.props.experiment = { id: 1, slug: 'example' }
  puck.dispatch.mockReset()
  puck.getSelectorForId.mockReset().mockReturnValue({ index: 2, zone: 'parent:content' })
  puck.selectors.length = 0
  puck.dragging = false
  puck.selected = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/preflight') ? { placements: [], checks: [] } : doc)))
})
afterEach(() => { cleanup(); targets?.test.remove(); targets?.controls.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

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
  const link = screen.getByRole('tab', { name: 'Original' })
  const open = vi.fn((event: MouseEvent) => event.preventDefault())
  link.addEventListener('click', open)
  fireEvent.click(link)
  expect(open).toHaveBeenCalledOnce()
  const input = screen.getByRole('tab', { name: 'Original' })
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
  showSidebar()
  puck.selected = selection as false | 'other'
  vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).endsWith('/preflight') ? { placements: [], checks: [] } : { ...doc, status }))
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
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
  showSidebar()
  vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).endsWith('/preflight') ? { placements: [], checks: [] } : { ...doc, status }))
  const original = puck.item.props.control
  puck.item.props.control = []
  try {
    const Editor = ExperimentSlotEditor.render
    render(<Editor {...props()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
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
  await screen.findByText("Couldn't load this test. Try selecting it again.")
  expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })).toBeTruthy()
  expect(screen.getByText('Original content')).toBeTruthy()
  vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).endsWith('/preflight') ? { placements: [], checks: [] } : doc))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('heading', { name: 'Example' })
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

test('decided banner uses the stored winner label', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...doc, status: 'decided', decision: { winnerArm: 'variantA' } }) } as Response)
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Decided: New headline. Use 'Make it the content' on the test to finish."))
})

test.each(['running', 'draft'].flatMap(status => [false, 'other'].map(selection => ({ status, selection }))))('$status: copy confirms existing content with selection $selection', async ({ status, selection }) => {
  showSidebar()
  puck.selected = selection as false | 'other'
  vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).endsWith('/preflight') ? { placements: [], checks: [] } : { ...doc, status }))
  const original = puck.item.props.variantA
  puck.item.props.variantA = [{ type: 'Text', props: { id: 'kept-id', text: 'Existing variant' } }] as never
  try {
    const Editor = ExperimentSlotEditor.render
    render(<Editor {...props()} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'New headline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Original here' }))
    expect(puck.dispatch).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('New headline already has content.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(puck.dispatch).not.toHaveBeenCalled()
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
  expect(screen.getByText('Drop New headline content here')).toBeTruthy()
  expect(screen.getByRole('tabpanel').querySelector('.xp-slot-panel')!.classList.contains('xp-slot-panel-empty')).toBe(true)
  fireEvent.click(screen.getByRole('tab', { name: 'Original' }))
  expect(screen.queryByText('Drop Original content here')).toBeNull()
  expect(screen.getByRole('tabpanel').querySelector('.xp-slot-panel')!.classList.contains('xp-slot-panel-empty')).toBe(false)
  puck.selected = false
  view.rerender(<Editor {...props()} />)
  expect(screen.getByRole('tabpanel').querySelector('.xp-slot-panel')!.classList.contains('xp-slot-panel-empty')).toBe(false)
  const control = puck.item.props.control
  puck.item.props.control = []
  try {
    view.rerender(<Editor {...props()} />)
    expect(screen.getByText('Drop Original content here')).toBeTruthy()
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

test('unbound header presents a setup state with one primary action', () => {
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props({ experiment: null })} />)
  expect(screen.getByRole('heading', { name: 'This Experiment block has no test yet.' })).toBeTruthy()
  expect(screen.queryByText('Not set up')).toBeNull()
  expect(screen.getByRole('button', { name: 'Set up test' }).classList.contains('xp-ui-button--primary')).toBe(true)
})

test.each(['draft', 'running'] as const)('custom routes reach the bound %s fetch', async status => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...doc, status })))
  const Editor = createExperimentSlotEditor({ routes: { api: '/content-api/', admin: '/manage/' } }).render
  render(<Editor {...props({ experiment: { id: 'id/with space', slug: 'example' } })} />)
  await screen.findByRole('heading', { name: 'Example' })
  expect(fetch).toHaveBeenCalledWith('/content-api/xp-experiments/id%2Fwith%20space?depth=0', expect.objectContaining({ credentials: 'include' }))
})

test.each([0, 1, 2])('shared notice uses existing placement read: %s placements', async count => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/preflight')
    ? { checks: [], placements: Array.from({ length: count }, (_, id) => ({ collection: 'pages', id, detail: 'Published' })) } : doc))))
  const Editor = createExperimentSlotEditor({ routes: { api: '/content-api' } }).render
  render(<Editor {...props()} />)
  await screen.findByRole('tab', { name: 'New headline' })
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/content-api/xp/experiments/1/preflight', expect.objectContaining({ credentials: 'include', cache: 'no-store' })))
  if (count > 0) {
    const notice = await screen.findByText('This test is also used in another place. Changes here affect that test.')
    expect(notice.closest('.xp-ui-banner')?.classList.contains('xp-ui-banner--info')).toBe(true)
  } else expect(screen.queryByText('This test is also used in another place. Changes here affect that test.')).toBeNull()
})

test('the click that ends a drag cannot dispatch another selection after Puck clears drag state', async () => {
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props({ experiment: null })} />)
  const heading = screen.getByRole('heading', { name: 'This Experiment block has no test yet.' })
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

test('bound header contains name, status, notices and plain tabs without action controls', async () => {
  const Editor = ExperimentSlotEditor.render
  render(<Editor {...props()} />)
  const title = await screen.findByRole('heading', { name: 'Example' })
  const chrome = within(title.closest<HTMLElement>('.xp-slot-chrome')!)
  expect(chrome.getByText('Running')).toBeTruthy()
  for (const name of [/Options/, /traffic/i, 'Split evenly', 'Configure test', /Start a new test/, /Remove the test/, 'Add variant', 'Add to the test', 'Delete its content', 'Refresh']) {
    expect(chrome.queryByRole('button', { name })).toBeNull()
  }
  expect(chrome.queryByRole('spinbutton')).toBeNull()
  expect(chrome.queryByRole('textbox')).toBeNull()
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Original', 'New headline'])
  expect(document.querySelector('.xp-ui-tab-actions')).toBeNull()
})

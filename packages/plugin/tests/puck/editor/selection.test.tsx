// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, registerOverlayPortal, useGetPuck, type Config } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'

const config: Config = { components: {
  ExperimentSlot: ExperimentSlotEditor,
  Container: { fields: { children: { type: 'slot' } }, render: ({ children: Children }) => <div><Children /></div> },
} }
const block = { type: 'ExperimentSlot', props: { id: 'test-block', experiment: { id: 'selection-test', slug: 'test' }, control: [], variantA: [], variantB: [], variantC: [] } }
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/preflight') ? { placements: [] } : {
    name: 'Selection test', status: 'draft', arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 50 }, { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50 }],
  }))))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

// Puck 0.24 AutoFrame (chunk-DQXMVPVM.mjs:12818–12843) requires the
// #frame-root supplied by srcDoc. jsdom 30.1.3 ignores srcdoc and loads an empty
// about:blank body (HTMLFrameElement-impl.js:118–158), so its iframe canvas
// never mounts. Exercise real Puck handlers here; check iframe mode in a browser.
test.each([false, true].flatMap(nested => [false, true].map(fullScreen => ({ nested, fullScreen }))))('real Puck header selects once (nested: $nested, fullScreen: $fullScreen)', async ({ nested, fullScreen }) => {
  const actions: unknown[] = []
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: {} }, content: nested ? [{ type: 'Container', props: { id: 'container', children: [block] } }] : [block] }}
    _experimentalFullScreenCanvas={fullScreen} iframe={{ enabled: false }} onAction={action => { if (action.type === 'setUi' && 'itemSelector' in action.ui) actions.push(action.ui.itemSelector) }}>
    <Puck.Preview /><Probe />
  </Puck>)
  const canvas = screen
  const heading = await canvas.findByRole('heading', { name: 'Selection test' })
  actions.length = 0
  // A tab click also leaves an initially unselected block unselected.
  fireEvent.click(canvas.getByRole('tab', { name: 'Variant A' }))
  expect(actions).toHaveLength(0)
  expect(read().appState.ui.itemSelector).toBeNull()
  fireEvent.click(heading)
  await waitFor(() => expect(read().appState.ui.itemSelector).toEqual(read().getSelectorForId('test-block')))
  expect(actions).toHaveLength(1)
  expect(actions[0]).toEqual(read().getSelectorForId('test-block'))
  actions.length = 0
  fireEvent.click(heading)
  expect(actions).toHaveLength(1)
  expect(read().appState.ui.itemSelector).toEqual(read().getSelectorForId('test-block'))
  actions.length = 0
  const chrome = heading.closest<HTMLElement>('.xp-slot-chrome')!
  for (const target of [within(chrome).getByRole('link', { name: 'Set up the test' }), within(chrome).getByLabelText('Original traffic (%)')]) {
    fireEvent.click(target)
    expect(read().appState.ui.itemSelector).toEqual(read().getSelectorForId('test-block'))
  }
  // Tabs deliberately change the visible version without selecting any component.
  fireEvent.click(canvas.getByRole('tab', { name: 'Variant A' }))
  fireEvent.click(within(chrome).getByRole('button', { name: 'Start a new test from this block' }))
  fireEvent.click(canvas.getByRole('heading', { name: 'Start a new test from this block' }))
  fireEvent.click(canvas.getByLabelText('Name'))
  expect(actions).toHaveLength(0)
  expect(read().appState.ui.itemSelector).toEqual(read().getSelectorForId('test-block'))
  fireEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(canvas.queryByRole('dialog')).toBeNull())
  fireEvent.click(canvas.getByRole('button', { name: 'Options for Variant A' }))
  fireEvent.click(canvas.getByRole('button', { name: 'Remove' }))
  fireEvent.click(canvas.getByRole('heading', { name: 'Remove Variant A?' }))
  expect(actions).toHaveLength(0)
  expect(read().appState.ui.itemSelector).toEqual(read().getSelectorForId('test-block'))
})

// Minimal pre-fix chrome: no plugin selection handler can explain these dispatches.
test.each([false, true])('Puck selects then clears a portal click (nested: %s)', async nested => {
  const nativeConfig: Config = { components: { ...config.components, ExperimentSlot: {
    render: () => <div ref={element => registerOverlayPortal(element, { disableDrag: true })}><h3>Native header</h3></div>,
  } } }
  const actions: unknown[] = []
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={nativeConfig} data={{ root: { props: {} }, content: nested ? [{ type: 'Container', props: { id: 'container', children: [block] } }] : [block] }}
    iframe={{ enabled: false }} onAction={action => { if (action.type === 'setUi' && 'itemSelector' in action.ui) actions.push(action.ui.itemSelector) }}><Puck.Preview /><Probe /></Puck>)
  const canvas = screen
  fireEvent.click(await canvas.findByRole('heading', { name: 'Native header' }))
  await waitFor(() => expect(actions.length).toBeGreaterThan(1))
  expect(actions[0]).toEqual(read().getSelectorForId('test-block'))
  if (nested) expect(actions).toContainEqual(read().getSelectorForId('container'))
  expect(actions.at(-1)).toBeNull()
  expect(read().appState.ui.itemSelector).toBeNull()
})

test.each(['draft', 'stopped', 'decided', 'archived', 'running'] as const)('%s detach obeys the live sharing rule and leaves other blocks alone', async status => {
  vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url).endsWith('/preflight') ? { placements: [] } : {
    name: 'Selection test', status, arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 50 }, { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50 }],
  })))
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  const other = { ...block, props: { ...block.props, id: 'other' } }
  render(<Puck config={config} data={{ root: { props: {} }, content: [block, other] }} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
  await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Selection test' })).toHaveLength(2))
  expect(screen.getAllByText('This test is also used in another place. Changes here affect that test.')).toHaveLength(2)
  const chrome = document.querySelectorAll<HTMLElement>('.xp-slot-chrome')[1]!
  const first = read().getItemById('test-block')
  fireEvent.click(within(chrome).getByLabelText('Select this test block'))
  fireEvent.click(within(chrome).getByRole('button', { name: 'Remove the test from this block' }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog.textContent).toContain(status === 'running' ? 'The test keeps running in its other place.' : 'The test and its results are kept.')
  fireEvent.click(within(dialog).getByRole('heading'))
  expect(read().appState.ui.itemSelector).toEqual(read().getSelectorForId('other'))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the test from this block' }))
  await waitFor(() => expect(read().getItemById('other')?.props.experiment).toBeNull())
  expect(read().getItemById('test-block')).toEqual(first)
  expect(screen.queryByText('This test is also used in another place. Changes here affect that test.')).toBeNull()
  if (status === 'running') await screen.findByText('Stop the test to remove it from this block.')
})

test.each(['removed', 'rebound'] as const)('creation in flight keeps its recovery dialog when the real block is %s', async race => {
  let complete!: (response: Response) => void
  vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return new Promise(resolve => { complete = resolve })
    return new Response(JSON.stringify(String(url).includes('where[slug]') ? { docs: [] } : String(url).endsWith('/preflight') ? { placements: [] } : {
      name: 'Selection test', status: 'draft', arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 50 }, { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50 }],
    }))
  })
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return <button onClick={() => {
    const puck = read(), selector = puck.getSelectorForId('test-block')!
    if (race === 'removed') puck.dispatch({ type: 'remove', index: selector.index, zone: selector.zone })
    else puck.dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone,
      data: { ...block, props: { ...block.props, experiment: { id: 'different', slug: 'different' } } } })
  }}>Race</button> }
  render(<Puck config={config} data={{ root: { props: { title: 'Page' } }, content: [block] }} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
  const heading = await screen.findByRole('heading', { name: 'Selection test' })
  const chrome = heading.closest<HTMLElement>('.xp-slot-chrome')!
  fireEvent.click(within(chrome).getByRole('button', { name: 'Start a new test from this block' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start a new test from this block' }))
  await waitFor(() => expect(complete).toBeTypeOf('function'))
  fireEvent.click(screen.getByRole('button', { name: 'Race' }))
  await act(async () => { complete(new Response(JSON.stringify({ doc: { id: 'created', slug: 'page' } }))) })
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText('The test was created, but this block changed or was removed. Open the test to continue.')).toBeTruthy()
  expect(within(dialog).getByRole('link', { name: 'Open the test' }).getAttribute('href')).toBe('/admin/experiments/created')
  if (race === 'removed') expect(read().appState.data.content).toEqual([])
  else expect(read().getItemById('test-block')?.props.experiment.id).toBe('different')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})


test('header allows Puck pointer events, controls block them, and non-interactive chrome selects once', async () => {
  const actions: unknown[] = []
  render(<Puck config={config} data={{ root: { props: {} }, content: [block] }} iframe={{ enabled: false }}
    onAction={action => { if (action.type === 'setUi' && 'itemSelector' in action.ui) actions.push(action.ui.itemSelector) }}><Puck.Preview /></Puck>)
  const heading = await screen.findByRole('heading', { name: 'Selection test' })
  const chrome = heading.closest<HTMLElement>('.xp-slot-chrome')!
  const pointer = vi.fn()
  chrome.parentElement!.addEventListener('pointerdown', pointer)
  fireEvent.pointerDown(heading)
  expect(pointer).toHaveBeenCalledOnce()
  pointer.mockClear()
  for (const control of [within(chrome).getByRole('link', { name: 'Set up the test' }), within(chrome).getByLabelText('Original traffic (%)'), within(chrome).getByText('Original traffic (%)'), screen.getByRole('tab', { name: 'Original' })]) fireEvent.pointerDown(control)
  expect(pointer).not.toHaveBeenCalled()
  for (const target of [heading, chrome, within(chrome).getByText('This block shows the Original to everyone until the test starts.')]) {
    actions.length = 0
    fireEvent.click(target)
    expect(actions).toHaveLength(1)
  }
})

test.each(['header', 'tab'] as const)('pressing the %s closes the version menu', async target => {
  render(<Puck config={config} data={{ root: { props: {} }, content: [block] }} iframe={{ enabled: false }}><Puck.Preview /></Puck>)
  const heading = await screen.findByRole('heading', { name: 'Selection test' })
  fireEvent.click(screen.getByRole('button', { name: 'Options for Original' }))
  expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy()
  fireEvent.pointerDown(target === 'header' ? heading : screen.getByRole('tab', { name: 'Variant A' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull())
})

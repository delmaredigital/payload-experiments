// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, registerOverlayPortal, useGetPuck, type Config } from '@puckeditor/core'
import { createExperimentSlotField } from '../../../src/puck/experimentSlotField.js'
import { EditorControls } from '../../../src/puck/editor/EditorControls.js'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
// These rendering/selection scenarios use a known manager. Access loading and
// denial use the real hook in permissions.test.tsx.
vi.mock('../../../src/puck/editor/editorSurface.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/puck/editor/editorSurface.js')>(),
  useEditorSurface: () => ({ surface: { canManage: true, canReadResults: true } }),
}))

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
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/preflight') ? { placements: [], checks: [] } : {
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
    <Puck.Preview /><div data-testid="fields"><Puck.Fields /></div><Probe />
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
  const fields = within(screen.getByTestId('fields'))
  for (const target of [await fields.findByLabelText('Original traffic (%)'), fields.getByRole('textbox', { name: 'Variant A Name' })]) {
    fireEvent.click(target)
    expect(read().appState.ui.itemSelector).toEqual(read().getSelectorForId('test-block'))
  }
  fireEvent.click(canvas.getByRole('tab', { name: 'Variant A' }))
  fireEvent.click(fields.getByRole('button', { name: 'Remove version' }))
  fireEvent.click(canvas.getByRole('heading', { name: 'Remove Variant A?' }))
  expect(actions).toHaveLength(0)
  expect(read().appState.ui.itemSelector).toEqual(read().getSelectorForId('test-block'))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  fireEvent.click(fields.getByRole('button', { name: 'More' }))
  fireEvent.click(fields.getByRole('button', { name: 'Use a different test' }))
  const chooser = await screen.findByRole('dialog')
  const picker = await within(chooser).findByRole('combobox')
  for (const target of [within(chooser).getByRole('heading'), picker, within(chooser).getByRole('button', { name: 'Create a test' })]) {
    fireEvent.pointerDown(target); fireEvent.pointerUp(target)
    if (target !== within(chooser).getByRole('button', { name: 'Create a test' })) fireEvent.click(target)
    fireEvent.keyDown(target, { key: 'ArrowDown' })
    expect(actions).toEqual([])
    expect(read().appState.ui.itemSelector).toEqual(read().getSelectorForId('test-block'))
  }
  fireEvent.click(within(chooser).getByRole('button', { name: 'Create a test' }))
  const create = await screen.findByRole('dialog')
  fireEvent.click(within(create).getByRole('textbox', { name: 'Name' }))
  expect(actions).toEqual([])
  expect(read().appState.ui.itemSelector).toEqual(read().getSelectorForId('test-block'))
  fireEvent.click(within(create).getByRole('button', { name: 'Cancel' }))
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
  for (const control of [screen.getByRole('tab', { name: 'Original' })]) fireEvent.pointerDown(control)
  expect(pointer).not.toHaveBeenCalled()
  for (const target of [heading, chrome, within(chrome).getByText('This block shows the Original to everyone until the test starts.')]) {
    actions.length = 0
    fireEvent.click(target)
    expect(actions).toHaveLength(1)
  }
})

test.each([false, true])('menu padding and all control descendants keep selection and block drag (%s)', async selected => {
  const actions: unknown[] = []
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  function Chrome() {
    const get = useGetPuck()
    return <EditorControls className="controls" onSelect={() => get().dispatch({ type: 'setUi', ui: { itemSelector: get().getSelectorForId('controls') } })}>
      <h3>Header</h3><div role="menu"><span>Menu child</span></div><div role="listbox"><span>List child</span></div>
      <button><span>Button child</span></button><label><span>Label child</span><input /></label>
    </EditorControls>
  }
  render(<Puck config={{ components: { Controls: { render: Chrome } } }} data={{ root: { props: {} }, content: [{ type: 'Controls', props: { id: 'controls' } }] }} iframe={{ enabled: false }}
    onAction={action => { if (action.type === 'setUi' && 'itemSelector' in action.ui) actions.push(action.ui.itemSelector) }}><Puck.Preview /><Probe /></Puck>)
  if (selected) fireEvent.click(screen.getByRole('heading', { name: 'Header' }))
  const before = read().appState.ui.itemSelector
  const chrome = document.querySelector('.controls')!
  const pointer = vi.fn()
  chrome.parentElement!.addEventListener('pointerdown', pointer)
  actions.length = 0
  for (const target of [screen.getByRole('menu'), screen.getByRole('listbox'), ...['Menu child', 'List child', 'Button child', 'Label child'].map(text => screen.getByText(text))]) {
    fireEvent.pointerDown(target); fireEvent.pointerUp(target); fireEvent.click(target)
  }
  expect(pointer).not.toHaveBeenCalled()
  expect(actions).toEqual([])
  expect(read().appState.ui.itemSelector).toEqual(before)
})

// Puck's delay sensor may activate a stationary long press; Puck owns the drop's
// single selection. The chrome must not repeat that dispatch for the trailing click.
test('an activated stationary press leaves Puck as the only selection dispatcher', async () => {
  let read!: ReturnType<typeof useGetPuck>
  const actions: unknown[] = []
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: {} }, content: [block] }} iframe={{ enabled: false }}
    onAction={action => { if (action.type === 'setUi' && 'itemSelector' in action.ui) actions.push(action.ui.itemSelector) }}><Puck.Preview /><Probe /></Puck>)
  const heading = await screen.findByRole('heading', { name: 'Selection test' })
  actions.length = 0
  fireEvent.pointerDown(heading)
  act(() => read().dispatch({ type: 'setUi', ui: { isDragging: true } }))
  fireEvent.pointerUp(heading)
  act(() => read().dispatch({ type: 'setUi', ui: { isDragging: false, itemSelector: read().getSelectorForId('test-block') } }))
  fireEvent.click(heading)
  expect(actions).toEqual([read().getSelectorForId('test-block')])
})




test('the public experimentSlotField No test option unbinds through real Puck without changing content', async () => {
  const publicConfig: Config = { ...config, components: { ...config.components, ExperimentSlot: {
    ...ExperimentSlotEditor, fields: { ...ExperimentSlotEditor.fields, experiment: createExperimentSlotField() },
  } } }
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => String(url).includes('/xp-experiments?')
    ? Promise.resolve(Response.json({ docs: [{ id: 'selection-test', slug: 'test', name: 'Selection test', status: 'draft' }] })) : original(url, init))
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={publicConfig} data={{ root: { props: {} }, content: [block] }} iframe={{ enabled: false }}
    ui={{ itemSelector: { index: 0, zone: 'root:default-zone' } }}><Puck.Preview /><Puck.Fields /><Probe /></Puck>)
  const picker = await screen.findByRole('combobox', { name: 'Test' })
  expect(picker.closest('.xp-ui-select-wrap')).toBeTruthy()
  fireEvent.change(picker, { target: { value: '' } })
  await waitFor(() => expect(read().getItemById('test-block')?.props.experiment).toBeNull())
  for (const slot of ['control', 'variantA', 'variantB', 'variantC']) expect(read().getItemById('test-block')?.props[slot]).toEqual([])
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

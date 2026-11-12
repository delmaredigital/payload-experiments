// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, useGetPuck, type Config } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { fixture, phaseFor } from '../../admin/results/fixtures.js'

const noAccess = "You don't have access to this test. You can still edit its content."
const detach = 'Remove the test from this block'
const doc = { name: 'Hero test', status: 'draft', arms: [
  { key: 'control', kind: 'control', label: 'Original', weight: 50 },
  { key: 'variantA', kind: 'variant', label: 'New headline', weight: 50 },
] }
const surface = { canManage: true, canReadResults: true, isAdmin: true, flagPoints: [], attributeKeys: {}, metricSources: [] }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const block = { type: 'ExperimentSlot', props: { id: 'permission-slot', experiment: { id: 'permission-test', slug: 'hero' },
  control: [{ type: 'Text', props: { id: 'original-text', text: 'Original content' } }],
  variantA: [{ type: 'Text', props: { id: 'variant-text', text: 'Variant content' } }], variantB: [], variantC: [] } }
let read!: ReturnType<typeof useGetPuck>
let statusCode: number | 'network'
function setup(role: 'none' | 'results' | 'manager' = 'none', initialCode = role === 'manager' ? 200 : 403, pending?: Promise<Response>, unbound = false) {
  statusCode = initialCode
  const snapshot = fixture('T7')
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/xp/editor-surface')) return pending ?? (role === 'none' ? response({}, 403) : response({ ...surface, canManage: role === 'manager' }))
    if (url.includes('/xp-experiments?')) return role === 'manager' ? response({ docs: [{ id: 'permission-test', slug: 'hero', ...doc }] }) : response({}, 403)
    if (url.includes('/xp-experiments/')) {
      if (statusCode === 'network') throw new Error('offline')
      return response(doc, statusCode)
    }
    if (url.endsWith('/preflight')) return response({ placements: [] }, role === 'manager' ? 200 : 403)
    if (url.includes('/results')) return response({ experiment: { name: doc.name, kind: 'block', status: 'running' }, phases: [phaseFor(snapshot)], snapshot, series: [] })
    throw new Error(`Unrouted ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const config: Config = { components: { ExperimentSlot: ExperimentSlotEditor,
    Text: { fields: { text: { type: 'text', label: 'Content text' } }, render: ({ text }) => <p>{text}</p> },
  } }
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: {} }, content: [unbound ? { ...block, props: { ...block.props, experiment: null } } : block] }} iframe={{ enabled: false }}>
    <Puck.Preview /><div data-testid="fields"><Puck.Fields /></div><Probe />
  </Puck>)
  return fetcher
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [] })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(async () => { cleanup(); await act(async () => {}); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('no test access: calm chrome, usable page versions and content editing, read-only sidebar, removal', async () => {
  const fetcher = setup()
  const chrome = document.querySelector<HTMLElement>('.xp-slot-chrome')!
  await within(chrome).findByText(noAccess)
  expect(within(chrome).queryByRole('alert')).toBeNull()
  expect(within(chrome).queryByRole('button', { name: 'Configure test' })).toBeNull()
  expect(within(chrome).queryByRole('button', { name: 'Start a new test from this block' })).toBeNull()
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Original', 'Variant A'])
  fireEvent.click(screen.getByRole('tab', { name: 'Variant A' }))
  expect(screen.getByText('Variant content')).toBeTruthy()
  expect(screen.queryByText('Original content')).toBeNull()
  // Select and edit the nested text through Puck's real sidebar, without a test document.
  act(() => read().dispatch({ type: 'setUi', ui: { itemSelector: read().getSelectorForId('variant-text')! } }))
  const text = await within(screen.getByTestId('fields')).findByLabelText('Content text')
  fireEvent.change(text, { target: { value: 'Edited variant' } })
  await waitFor(() => expect(read().getItemById('variant-text')?.props.text).toBe('Edited variant'))
  fireEvent.click(within(chrome).getByRole('heading'))
  const fields = screen.getByTestId('fields')
  await within(fields).findByText(noAccess)
  expect(within(fields).queryByRole('combobox')).toBeNull()
  expect(within(fields).queryByRole('button', { name: 'Configure test' })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(within(chrome).getByRole('button', { name: detach }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: detach }))
  await waitFor(() => expect(read().getItemById('permission-slot')?.props.experiment).toBeNull())
  expect(read().getItemById('variant-text')?.props.text).toBe('Edited variant')
  expect(screen.queryByRole('button', { name: 'Test this block' })).toBeNull()
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/preflight'))).toBe(false)
})

test.each([401, 403, 404])('a fresh status %s permits confirmation and detach; save is authoritative', async code => {
  setup('manager')
  await screen.findByRole('heading', { name: doc.name })
  statusCode = code
  const before = structuredClone(read().getItemById('permission-slot')?.props.variantA)
  fireEvent.click(await screen.findByRole('button', { name: detach }))
  const dialog = await screen.findByRole('dialog')
  expect(read().getItemById('permission-slot')?.props.experiment).toEqual(block.props.experiment)
  fireEvent.click(within(dialog).getByRole('button', { name: detach }))
  await waitFor(() => expect(read().getItemById('permission-slot')?.props.experiment).toBeNull())
  expect(read().getItemById('permission-slot')?.props.variantA).toEqual(before)
})

test.each([500, 'network'] as const)('status %s refuses detach with the existing retry sentence', async code => {
  setup('manager')
  await screen.findByRole('heading', { name: doc.name })
  statusCode = code
  fireEvent.click(await screen.findByRole('button', { name: detach }))
  await screen.findByText("Couldn't check where this test is used. Try again.")
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(read().getItemById('permission-slot')?.props.experiment).toEqual(block.props.experiment)
  statusCode = 200
  fireEvent.click(screen.getByRole('button', { name: detach }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
})

test('results-only: Configure opens the reader, creation and version management stay hidden, removal works', async () => {
  const fetcher = setup('results')
  await screen.findByText("You can view this test's results.")
  expect(screen.queryByText(noAccess)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Start a new test from this block' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Add variant' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Configure test' }))
  const drawer = await screen.findByRole('dialog')
  await within(drawer).findByRole('table', { name: 'Registrations' })
  expect(within(drawer).queryByLabelText('Test name')).toBeNull()
  expect(within(drawer).getByRole('link', { name: 'Open in a new tab' }).getAttribute('href')).toBe('/admin/experiments/permission-test/results')
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: detach }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: detach }))
  await waitFor(() => expect(read().getItemById('permission-slot')?.props.experiment).toBeNull())
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/preflight'))).toBe(false)
  expect(screen.queryByRole('button', { name: 'Test this block' })).toBeNull()
})

test('manager retains setup, creation and version management controls', async () => {
  setup('manager')
  await screen.findByRole('heading', { name: doc.name })
  expect(screen.getByRole('button', { name: 'Configure test' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Start a new test from this block' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Add variant' })).toBeTruthy()
})


test('a page-owned variant tab survives clearing its last child, so content can be replaced', async () => {
  setup()
  await screen.findByText(noAccess)
  fireEvent.click(screen.getByRole('tab', { name: 'Variant A' }))
  await act(async () => {
    const selector = read().getSelectorForId('variant-text')!
    read().dispatch({ type: 'remove', index: selector.index, zone: selector.zone })
  })
  expect(screen.getByRole('tab', { name: 'Variant A' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('Drop Variant A content here')).toBeTruthy()
  await act(async () => {
    const selector = read().getSelectorForId('permission-slot')!
    const item = read().getItemById('permission-slot')!
    read().dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone,
      data: { ...item, props: { ...item.props, variantA: [{ type: 'Text', props: { id: 'replacement-text', text: 'Replacement content' } }] } } })
  })
  expect(await screen.findByText('Replacement content')).toBeTruthy()
  expect(screen.queryByText('Original content')).toBeNull()
})


test.each([false, true])('pending permissions keep management actions absent from first paint (unbound %s)', async unbound => {
  let resolve!: (response: Response) => void
  const pending = new Promise<Response>(done => { resolve = done })
  setup('manager', 200, pending, unbound)
  expect(screen.getByRole('status').textContent).toContain('Loading')
  for (const name of ['Test this block', 'Start a new test from this block', 'Configure test', 'Add variant']) {
    expect(screen.queryByRole('button', { name })).toBeNull()
  }
  await act(async () => { resolve(response(surface)) })
  expect(await screen.findByRole('button', { name: unbound ? 'Test this block' : 'Start a new test from this block' })).toBeTruthy()
})
test('an unbound block without access names tests generally and offers no actions', async () => {
  setup('none', 403, undefined, true)
  await screen.findByText("You don't have access to tests.")
  expect(screen.queryByText(noAccess)).toBeNull()
  expect(document.querySelector('.xp-slot-chrome .xp-ui-button-group')?.textContent).toBe('')
})
test('a bound 404 is calm, retains page-owned version tabs and permits removal', async () => {
  setup('manager', 404)
  await screen.findByText("This test isn't available to you. You can still edit its content.")
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Configure test' })).toBeNull()
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Original', 'Variant A'])
  fireEvent.click(screen.getByRole('tab', { name: 'Variant A' }))
  expect(screen.getByText('Variant content')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: detach }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: detach }))
  await waitFor(() => expect(read().getItemById('permission-slot')?.props.experiment).toBeNull())
})


test.each(['none', 'results', 'manager'] as const)('a deleted bound test takes priority for a %s reader and never offers Configure', async role => {
  setup(role, 404)
  const chrome = document.querySelector<HTMLElement>('.xp-slot-chrome')!
  await within(chrome).findByText("This test isn't available to you. You can still edit its content.")
  expect(within(chrome).queryByText("You can view this test's results.")).toBeNull()
  expect(within(chrome).queryByRole('button', { name: 'Configure test' })).toBeNull()
  expect(within(chrome).queryByRole('alert')).toBeNull()
})

test('an unbound results-only reader sees the setup-access line without a create invitation', async () => {
  setup('results', 200, undefined, true)
  const chrome = document.querySelector<HTMLElement>('.xp-slot-chrome')!
  await within(chrome).findByText("You don't have access to set up tests.")
  expect(within(chrome).queryByText('Choose or create a test to show different versions.')).toBeNull()
  expect(within(chrome).queryByRole('button')).toBeNull()
})

test.each([500, 'network', 'malformed'] as const)('a failed controls read (%s) is quiet and Retry loads the bound controls', async failure => {
  let finish!: (response: Response) => void
  let reject!: (cause: Error) => void
  const pending = new Promise<Response>((resolve, fail) => { finish = resolve; reject = fail })
  const fetcher = setup('manager', 200, pending)
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation((url: string) => {
    if (url.endsWith('/xp/editor-surface')) {
      if (failure === 'network') return Promise.reject(new Error('offline'))
      return Promise.resolve(response(failure === 'malformed' ? {} : null, failure === 500 ? 500 : 200))
    }
    return original(url)
  })
  await act(async () => {
    if (failure === 'network') reject(new Error('offline'))
    else finish(failure === 'malformed' ? response({}) : response({}, 500))
  })
  const chrome = document.querySelector<HTMLElement>('.xp-slot-chrome')!
  await within(chrome).findByText("Test controls couldn't load.")
  expect(within(chrome).queryByRole('alert')).toBeNull()
  expect(within(chrome).queryByText('This block shows the Original to everyone until the test starts.')).toBeNull()
  expect(within(chrome).queryByRole('button', { name: 'Configure test' })).toBeNull()
  fetcher.mockImplementation((url: string) => url.endsWith('/xp/editor-surface') ? Promise.resolve(response(surface)) : original(url))
  fireEvent.click(within(chrome).getByRole('button', { name: 'Retry' }))
  expect(await within(chrome).findByRole('button', { name: 'Configure test' })).toBeTruthy()
  expect(within(chrome).queryByText("Test controls couldn't load.")).toBeNull()
})

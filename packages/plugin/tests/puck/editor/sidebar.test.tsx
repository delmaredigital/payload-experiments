// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, useGetPuck, type Config } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { newTestBody } from '../../../src/puck/editor/editor.model.js'
import { publishExperiment } from '../../../src/puck/editor/armsCache.js'
import { editorCopy as C } from '../../../src/puck/editor/copy.js'
import type { Status } from '../../../src/types/contracts.js'

const base = { ...newTestBody({ kind: 'block', name: 'Hero test', slug: 'hero', unitType: 'visitor' }), id: 'sidebar-test', status: 'draft' as Status, updatedAt: 'one' }
let doc: typeof base
let role: 'manager' | 'results' | 'none'
let failed: boolean
let testCode: number
let checks: Array<{ code: string; ok: boolean }>
let refusal: boolean
let read!: ReturnType<typeof useGetPuck>
const block = { type: 'ExperimentSlot', props: { id: 'sidebar-block', experiment: { id: 'sidebar-test', slug: 'hero' }, control: [], variantA: [], variantB: [], variantC: [] } }
const config: Config = { components: { ExperimentSlot: ExperimentSlotEditor, Text: { render: () => <p>Content</p> } } }
const reply = (value: unknown, status = 200) => Response.json(value, { status })
function fields() { return within(screen.getByTestId('sidebar')) }
function chrome() { return within(document.querySelector<HTMLElement>('.xp-slot-chrome')!) }
async function mount(unbound = false, leftover = false) {
  function Probe() { read = useGetPuck(); return null }
  const actions: unknown[] = []
  render(<Puck config={config} data={{ root: { props: {} }, content: [{ ...block, props: { ...block.props, experiment: unbound ? null : block.props.experiment,
    variantC: leftover ? [{ type: 'Text', props: { id: 'leftover' } }] : [] } }] }} iframe={{ enabled: false }} onAction={action => {
    if (action.type === 'setUi' && 'itemSelector' in action.ui) actions.push(action)
  }}><Puck.Preview /><div data-testid="sidebar"><Puck.Fields /></div><Probe /></Puck>)
  await waitFor(() => expect(chrome().queryByText('Loading test…')).toBeNull())
  act(() => read().dispatch({ type: 'setUi', ui: { itemSelector: read().getSelectorForId('sidebar-block')! } }))
  await fields().findByRole('region', { name: 'Actions' })
  if (role === 'manager') await fields().findByRole('combobox')
  actions.length = 0
  return actions
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  doc = structuredClone(base); role = 'manager'; failed = false; testCode = 200; refusal = false; checks = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/editor-surface')) return role === 'none' ? reply({}, 403) : reply({ canManage: role === 'manager', canReadResults: true, flagPoints: [], pageCollections: [], attributeKeys: {}, metricSources: [] })
    if (url.includes('/xp-experiments?')) return role === 'manager' ? reply({ docs: [doc] }) : reply({}, 403)
    if (url.endsWith('/preflight')) return reply({ placements: [], checks })
    if (url.includes('/summary?')) return reply({})
    if (url.endsWith('/results')) return reply({})
    if (url.endsWith('/start') || url.endsWith('/stop')) {
      if (refusal) return reply({ errors: [{ code: 'forbidden', message: 'PRIVATE' }] }, 403)
      doc = { ...doc, status: url.endsWith('/start') ? 'running' : 'stopped', updatedAt: `${doc.updatedAt}!` }
      return reply({ doc })
    }
    if (init?.method === 'PATCH') { doc = { ...doc, ...JSON.parse(String(init.body)), updatedAt: `${doc.updatedAt}!` }; return reply({ doc }) }
    return failed ? reply({}, 500) : reply(doc, testCode)
  }))
})
afterEach(async () => { cleanup(); await act(async () => {}); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test.each(['draft', 'running', 'stopped', 'decided'] as const)('%s sidebar has ordered Test, Versions and Actions with the matching controls', async status => {
  doc.status = status
  await mount()
  expect(fields().getAllByRole('heading', { level: 4 }).map(node => node.textContent)).toEqual(['Test', 'Versions', 'Actions'])
  expect(fields().getByRole('combobox')).toBeTruthy()
  const versions = fields().getByRole('region', { name: C.versionsGroup })
  expect(within(versions).getAllByRole('spinbutton')).toHaveLength(2)
  expect((within(versions).getByLabelText(C.weight('Original')) as HTMLInputElement).disabled).toBe(status === 'running' || status === 'decided')
  expect(!!fields().queryByRole('button', { name: C.add })).toBe(status === 'draft' || status === 'stopped')
  expect(!!fields().queryByRole('button', { name: C.remove })).toBe(status === 'draft' || status === 'stopped')
  if (status === 'draft') await fields().findByRole('button', { name: 'Start' })
  expect(!!fields().queryByRole('button', { name: 'Start' })).toBe(status === 'draft')
  expect(!!fields().queryByRole('button', { name: 'Stop' })).toBe(status === 'running')
  expect(fields().queryByRole('button', { name: /Decide/ })).toBeNull()
  expect(fields().getByRole('button', { name: C.configure })).toBeTruthy()
})

test('sidebar edits and transitions update chrome without reload or Puck selection changes', async () => {
  const actions = await mount()
  const selected = read().appState.ui.itemSelector
  fireEvent.click(fields().getByRole('button', { name: C.add }))
  await screen.findByRole('tab', { name: 'Variant B' })
  expect(fields().getAllByRole('spinbutton')).toHaveLength(3)
  const input = fields().getByLabelText(C.weight('Original'))
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false))
  fireEvent.change(input, { target: { value: '60' } }); fireEvent.blur(input)
  await waitFor(() => expect((chrome().getByLabelText(C.weight('Original')) as HTMLInputElement).value).toBe('60'))
  await waitFor(() => expect((fields().getByRole('button', { name: C.menu('Variant A') }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(fields().getByRole('button', { name: C.menu('Variant A') }))
  fireEvent.click(fields().getByRole('button', { name: C.rename }))
  const name = fields().getByLabelText(C.renameLabel)
  fireEvent.change(name, { target: { value: 'New headline' } }); fireEvent.keyDown(name, { key: 'Enter' })
  await screen.findByRole('tab', { name: 'New headline' })
  await waitFor(() => expect((fields().getAllByRole('button', { name: C.remove })[0] as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(fields().getAllByRole('button', { name: C.remove })[0]!)
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(C.removeHelp(0))).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: C.remove }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'New headline' })).toBeNull())
  fireEvent.click(await fields().findByRole('button', { name: 'Start' }))
  await fields().findByRole('button', { name: 'Stop' })
  expect(chrome().getByText('Running')).toBeTruthy()
  fireEvent.click(fields().getByRole('button', { name: 'Stop' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stop' }))
  await waitFor(() => expect(chrome().getByText('Stopped')).toBeTruthy())
  expect(fields().getByRole('button', { name: C.add })).toBeTruthy()
  expect(read().appState.ui.itemSelector).toEqual(selected)
  expect(actions).toEqual([])
})

test.each(['results', 'none', 'unavailable', 'failed', 'unbound'] as const)('sidebar state: %s', async state => {
  if (state === 'results' || state === 'none') { role = state; testCode = 403 }
  if (state === 'unavailable') testCode = 404
  if (state === 'failed') failed = true
  await mount(state === 'unbound')
  expect(fields().queryByRole('region', { name: C.versionsGroup })).toBeNull()
  if (state === 'results') {
    expect(fields().getByText("You can view this test's results.")).toBeTruthy()
    expect(fields().getByRole('button', { name: C.configure })).toBeTruthy()
  } else if (state === 'none') expect(fields().getAllByText("You don't have access to this test. You can still edit its content.").length).toBeGreaterThan(0)
  else if (state === 'unavailable') expect(fields().getByText("This test isn't available to you. You can still edit its content.")).toBeTruthy()
  else if (state === 'failed') {
    expect(fields().getByText(C.loadError)).toBeTruthy()
    failed = false; fireEvent.click(fields().getByRole('button', { name: C.retrySetup }))
    await fields().findByRole('region', { name: C.versionsGroup })
  } else {
    expect(fields().getByRole('combobox')).toBeTruthy()
    expect(fields().getByRole('button', { name: C.createLabel })).toBeTruthy()
  }
})

test('sidebar leftovers share Add to the test and Delete its content paths', async () => {
  await mount(false, true)
  fireEvent.click(fields().getByRole('button', { name: C.addLeftover }))
  await screen.findByRole('tab', { name: 'Variant C' })
  expect(chrome().queryByRole('button', { name: C.addLeftover })).toBeNull()
  expect(fields().getAllByRole('spinbutton')).toHaveLength(3)
})

test('sidebar uses the drawer blocker sentence and transition refusal', async () => {
  checks = [{ code: 'no-primary-metric', ok: false }]
  await mount()
  expect(fields().getByText('Before you can start: Choose a goal.')).toBeTruthy()
  expect(fields().queryByRole('button', { name: 'Start' })).toBeNull()
  checks = []
  // The same chrome action refreshes shared readiness after writing.
  fireEvent.click(chrome().getByRole('button', { name: C.split }))
  await fields().findByRole('button', { name: 'Start' })
  refusal = true
  fireEvent.click(fields().getByRole('button', { name: 'Start' }))
  expect((await fields().findByRole('alert')).textContent).toBe("You don't have permission to do this.")
  expect(document.body.textContent).not.toContain('PRIVATE')
})


test('cross-surface Split evenly clears shared invalid weight edits in both places', async () => {
  await mount()
  const chromeInput = chrome().getByLabelText(C.weight('Original'))
  fireEvent.change(chromeInput, { target: { value: '101' } })
  expect((fields().getByLabelText(C.weight('Original')) as HTMLInputElement).value).toBe('101')
  expect(fields().queryByRole('button', { name: 'Start' })).toBeNull()
  fireEvent.click(fields().getByRole('button', { name: C.split }))
  await waitFor(() => expect((chromeInput as HTMLInputElement).value).toBe('50'))
  expect(chrome().queryByText(C.invalidShare)).toBeNull()
  expect(fields().queryByText(C.invalidShare)).toBeNull()
})


test('pending focus refresh explains why Start is hidden even with prior readiness', async () => {
  await mount()
  await fields().findByRole('button', { name: 'Start' })
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight') ? new Promise(resolve => { finish = resolve }) : original(url, init))
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_001)
  fireEvent(window, new Event('focus'))
  expect(fields().getByText('Before you can start: Checking readiness…')).toBeTruthy()
  expect(fields().queryByRole('button', { name: 'Start' })).toBeNull()
  await act(async () => { finish(reply({ checks: [], placements: [] })) })
  await fields().findByRole('button', { name: 'Start' })
})


test('a completed version write supersedes readiness requested before the PATCH', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  let finishOld!: (response: Response) => void
  let reads = 0
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).endsWith('/preflight') && reads++ === 0) return new Promise(resolve => { finishOld = resolve })
    return original(url, init)
  })
  await mount()
  fireEvent.click(fields().getByRole('button', { name: C.add }))
  await screen.findByRole('tab', { name: 'Variant B' })
  await fields().findByRole('button', { name: 'Start' })
  await act(async () => { finishOld(reply({ checks: [{ code: 'no-primary-metric', ok: false }], placements: [] })) })
  expect(fields().getByRole('button', { name: 'Start' })).toBeTruthy()
  expect(fields().queryByText('Before you can start: Choose a goal.')).toBeNull()
  expect(reads).toBe(2)
})


test('sidebar removal mounts its shared modal in the sidebar document and Cancel restores focus', async () => {
  const actions = await mount()
  const trigger = fields().getByRole('button', { name: C.remove })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = await screen.findByRole('dialog')
  expect(screen.getByTestId('sidebar').contains(dialog)).toBe(true)
  expect(dialog.ownerDocument).toBe(trigger.ownerDocument)
  expect(chrome().queryByRole('dialog')).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: C.cancel }))
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(actions).toEqual([])
})


test('a drawer status transition clears staged draft shares so Stop stays available', async () => {
  await mount()
  fireEvent.change(fields().getByLabelText(C.weight('Original')), { target: { value: '101' } })
  doc = { ...doc, status: 'running', updatedAt: 'newer' }
  act(() => publishExperiment(doc.id, doc))
  const stop = await fields().findByRole('button', { name: 'Stop' })
  await waitFor(() => expect((stop as HTMLButtonElement).disabled).toBe(false))
  expect((fields().getByLabelText(C.weight('Original')) as HTMLInputElement).value).toBe('50')
  expect(fields().queryByText(C.invalidShare)).toBeNull()
})


test('pending initial placements still explains conditional impact on other pages', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight') ? new Promise(resolve => { finish = resolve }) : original(url, init))
  await mount()
  fireEvent.click(fields().getByRole('button', { name: C.remove }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(C.removeScopeUnknown)).toBeTruthy()
  await act(async () => { finish(reply({ placements: [{ collection: 'pages', id: 'other', detail: 'Published' }], checks: [] })) })
  expect(within(dialog).getByText(C.removeShared)).toBeTruthy()
})

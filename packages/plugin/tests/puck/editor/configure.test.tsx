// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, useGetPuck, type Config } from '@puckeditor/core'
import { ConfigureTestDrawer } from '../../../src/puck/editor/ConfigureTestDrawer.js'
import { createExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import type { SurfaceProps } from '../../../src/testSurface/surface/contracts.js'
import { doc as base, preflight } from '../../admin/surface/readiness/fixtures.js'
import { fixture, phaseFor } from '../../admin/results/fixtures.js'
import type { TestDocument } from '../../../src/testSurface/surface/testDocument.model.js'

const surface: Omit<SurfaceProps, 'apiRoute' | 'adminRoute'> = { canManage: true, canReadResults: true, isAdmin: true, flagPoints: [],
  attributeKeys: { country: { type: 'string' } }, metricSources: [] }
const block = (id = 'test-block') => ({ type: 'ExperimentSlot', props: { id, experiment: { id: base.id, slug: base.slug }, control: [], variantA: [], variantB: [], variantC: [] } })
const snapshot = fixture('T7'), phase = phaseFor(snapshot)
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let saved: TestDocument
let startRefusal = ''
let read!: ReturnType<typeof useGetPuck>
let actions: unknown[]
function setup(status: TestDocument['status'] = 'draft', context = surface, count = 1) {
  saved = { ...base, status, updatedAt: '2026-11-12T10:00:00Z', ...(status === 'decided' ? { decision: { phase: phase.phase, winnerArm: 'variantA' } } : {}) }
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/xp/editor-surface')) return response(context)
    if (url.includes('/xp-experiments?')) return response({ docs: [saved] })
    if (url.endsWith('/start')) {
      if (startRefusal) return response({ errors: [{ code: 'invalid-status', message: startRefusal }] }, 400)
      saved = { ...saved, status: 'running' }; return response({ doc: saved, revision: 1 })
    }
    if (url.endsWith('/stop')) { saved = { ...saved, status: 'stopped' }; return response({ doc: saved, revision: 1 }) }
    if (url.endsWith('/decide')) { saved = { ...saved, status: 'decided', decision: { phase: phase.phase, winnerArm: 'variantA' } }; return response({ doc: saved, revision: 1 }) }
    if (init?.method === 'PATCH') { saved = { ...saved, ...JSON.parse(String(init.body)), updatedAt: '2026-11-12T10:01:00Z' }; return response({ doc: saved }) }
    if (url.includes('/xp-experiments/')) return response(saved)
    if (url.endsWith('/preflight')) return context.canManage ? response(preflight()) : response({}, 403)
    if (url.includes('/results')) return response(saved.status === 'draft' ? { experiment: { name: saved.name, kind: saved.kind, status: saved.status }, phases: [], snapshot: null, series: [] } : { experiment: { name: saved.name, kind: saved.kind, status: saved.status }, phases: [phase], snapshot, series: [] })
    if (url.includes('/summary?')) return response({ [saved.id]: { exposures: 100 } })
    if (url.includes('/xp-metrics')) return response({ docs: [{ id: 1, name: 'Registrations', source: 'registration' }, { id: 2, name: 'Lessons', source: 'lessons' }, { id: 3, name: 'Donations', source: 'donations' }] })
    if (url.endsWith('/click-keys')) return response({ keys: [] })
    throw new Error(`Unrouted ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const config: Config = { components: { ExperimentSlot: createExperimentSlotEditor({ routes: { api: '/api', admin: '/manage' } }) } }
  function Probe() { read = useGetPuck(); return null }
  actions = []
  const editor = <Puck config={config} data={{ root: { props: {} }, content: Array.from({ length: count }, (_, i) => block(i === 0 ? 'test-block' : `other-${i}`)) }} iframe={{ enabled: false }}
    onAction={action => { if (action.type === 'setUi' && 'itemSelector' in action.ui) actions.push(action.ui.itemSelector) }}>
    <Puck.Preview /><div data-testid="fields"><Puck.Fields /></div><Probe />
  </Puck>
  render(editor)
  return fetcher
}
beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  startRefusal = ''
  // Puck's body capture listener hit-tests even idle pointer moves. jsdom has no layout.
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [] })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(async () => { cleanup(); await act(async () => {}); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function open(from: 'chrome' | 'sidebar' = 'chrome') {
  const heading = (await screen.findAllByRole('heading', { name: base.name }))[0]!
  if (from === 'sidebar') fireEvent.click(heading)
  const area = from === 'sidebar' ? screen.getByTestId('fields') : heading.closest<HTMLElement>('.xp-slot-chrome')!
  const trigger = await within(area).findByRole('button', { name: 'Configure test' })
  trigger.focus()
  fireEvent.click(trigger)
  const drawer = await screen.findByRole('dialog')
  return { trigger, drawer }
}

test.each(['chrome', 'sidebar'] as const)('opens from %s, provides the shared setup, and opens navigation in a new tab', async from => {
  setup()
  const { drawer } = await open(from)
  await within(drawer).findByLabelText('Test name')
  expect(within(drawer).getByText('Edit version content on the canvas.')).toBeTruthy()
  for (const label of ["What you're testing", "Versions", "What counts as a win", "Who takes part (optional)", "How long"]) {
    // The same named sections/rail used by the admin mount.
    expect(drawer.textContent).toContain(label)
  }
  expect(within(drawer).getByRole('link', { name: 'Open in a new tab' }).getAttribute('href')).toBe(`/manage/experiments/${base.id}`)
  const goals = within(drawer).getByRole('link', { name: 'Manage goals' })
  fireEvent.click(goals)
  expect(goals.getAttribute('target')).toBe('_blank')
  expect(goals.getAttribute('rel')).toBe('noopener noreferrer')
  expect(within(drawer).queryByRole('link', { name: 'Back to admin' })).toBeNull()
})

test.each(['chrome', 'sidebar'].flatMap(from => ['Escape', 'Close', 'backdrop'].map(how => ({ from: from as 'chrome' | 'sidebar', how }))))('$from closes with $how and restores focus', async ({ from, how }) => {
  setup()
  const { trigger, drawer } = await open(from)
  if (how === 'Escape') fireEvent.keyDown(drawer, { key: 'Escape' })
  else if (how === 'Close') fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  else { fireEvent.pointerDown(drawer, { clientX: -10, clientY: -10 }); fireEvent.pointerUp(drawer, { clientX: -10, clientY: -10 }); fireEvent.click(drawer, { clientX: -10, clientY: -10 }) }
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(document.activeElement).toBe(trigger)
})

test.each(['draft', 'running', 'stopped', 'decided'] as const)('renders the shared %s test surface', async status => {
  setup(status)
  const { drawer } = await open()
  await within(drawer).findByLabelText('Test name')
  expect(drawer.querySelector('.xp-test-readiness-bar')).toBeTruthy()
  expect(drawer.querySelector('#section-win')).toBeTruthy()
  expect(drawer.querySelector('#section-who')).toBeTruthy()
  expect(drawer.querySelector('#section-length')).toBeTruthy()
  if (status === 'draft') expect(within(drawer).getByRole('button', { name: 'Start' })).toBeTruthy()
  if (status === 'running') expect(within(drawer).getByRole('button', { name: 'Stop' })).toBeTruthy()
  if (status === 'stopped') expect(within(drawer).getByRole('button', { name: 'Start a new round' })).toBeTruthy()
  if (status === 'decided') expect(within(drawer).getByRole('button', { name: 'Make it the content' })).toBeTruthy()
  if (status !== 'draft') await within(drawer).findByRole('table', { name: 'Registrations' })
})

test('results-only permissions use the admin reader surface with no management requests or actions', async () => {
  const fetcher = setup('running', { ...surface, canManage: false })
  const { drawer } = await open()
  await within(drawer).findByRole('table', { name: 'Registrations' })
  expect(within(drawer).queryByLabelText('Test name')).toBeNull()
  expect(within(drawer).getByRole('link', { name: 'Open in a new tab' }).getAttribute('href')).toBe(`/manage/experiments/${base.id}/results`)
  for (const action of ['Start', 'Stop', 'Decide', 'Recompute']) expect(within(drawer).queryByRole('button', { name: action })).toBeNull()
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH' || init?.method === 'POST')).toEqual([])
})

test('Start and Stop update all bound blocks without changing the page or reloading', async () => {
  const fetcher = setup('draft', surface, 2)
  const before = structuredClone(read().appState.data)
  const { drawer } = await open()
  const start = await within(drawer).findByRole('button', { name: 'Start' })
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(start)
  await waitFor(() => expect(document.querySelectorAll('.xp-slot-chrome .xp-ui-status--running')).toHaveLength(2))
  fireEvent.click(await within(drawer).findByRole('button', { name: 'Stop' }))
  const dialogs = screen.getAllByRole('dialog')
  const confirmation = dialogs.find(dialog => dialog !== drawer)!
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Stop' }))
  await waitFor(() => expect(document.querySelectorAll('.xp-slot-chrome .xp-ui-status--stopped')).toHaveLength(2))
  expect(read().appState.data).toEqual(before)
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/start') || url.endsWith('/stop'))).toHaveLength(2)
})

test('a saved name updates the chrome; versions summarize canvas labels and edit shares only', async () => {
  setup()
  const { drawer } = await open()
  const name = await within(drawer).findByLabelText('Test name')
  fireEvent.change(name, { target: { value: 'New test title' } }); fireEvent.blur(name)
  await waitFor(() => expect(document.querySelector('.xp-slot-title')?.textContent).toBe('New test title'))
  expect(within(drawer).queryByLabelText('Variant A: Version label')).toBeNull()
  expect(within(drawer).queryByRole('button', { name: 'Add version' })).toBeNull()
  expect(within(drawer).queryByRole('button', { name: 'Remove version' })).toBeNull()
  expect(within(drawer).getByLabelText('Variant A: Share (%)')).toBeTruthy()
})

test('a start refusal displays the same server sentence without a custom page-save warning', async () => {
  setup()
  startRefusal = 'Publish this page before starting the test.'
  const { drawer } = await open()
  const start = await within(drawer).findByRole('button', { name: 'Start' })
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(start)
  expect(await within(drawer).findByText(startRefusal)).toBeTruthy()
  expect(document.querySelector('.xp-slot-chrome .xp-ui-status--draft')).toBeTruthy()
})

test.each([false, true])('drawer clicks, keys and pointer events preserve real Puck selection (selected: %s)', async selected => {
  setup()
  if (selected) fireEvent.click(await screen.findByRole('heading', { name: base.name }))
  const before = read().appState.ui.itemSelector
  const { drawer } = await open()
  const name = await within(drawer).findByLabelText('Test name')
  actions.length = 0
  for (const target of [drawer, name, within(drawer).getByText('Edit version content on the canvas.')]) {
    fireEvent.pointerDown(target); fireEvent.pointerMove(target, { clientX: 100 }); fireEvent.pointerUp(target)
    fireEvent.click(target); fireEvent.keyDown(target, { key: 'ArrowRight' })
  }
  expect(actions).toEqual([])
  expect(read().appState.ui.itemSelector).toEqual(before)
  expect(read().appState.data.content).toEqual([block()])
})


test('Decide uses the shared confirmation and refreshes block status without a host reload', async () => {
  setup('running')
  const { drawer } = await open()
  fireEvent.click(await within(drawer).findByRole('button', { name: 'Decide' }))
  const confirmation = screen.getAllByRole('dialog').find(dialog => dialog !== drawer)!
  const decide = within(confirmation).getByRole('button', { name: 'Decide' })
  await waitFor(() => expect((decide as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(decide)
  await waitFor(() => expect(document.querySelector('.xp-slot-chrome .xp-ui-status--decided')).toBeTruthy())
  expect(screen.getAllByRole('dialog')).toEqual([drawer])
  expect(read().appState.data.content).toEqual([block()])
})


test('a successful Start still updates chrome after the drawer closes during the request', async () => {
  const fetcher = setup()
  const original = fetcher.getMockImplementation()!
  let finish!: (response: Response) => void
  fetcher.mockImplementation((url, init) => url.endsWith('/start') ? new Promise<Response>(resolve => { finish = resolve }) : original(url, init))
  const { drawer } = await open()
  const start = await within(drawer).findByRole('button', { name: 'Start' })
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(start)
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await act(async () => finish(response({ doc: { ...saved, status: 'running' }, revision: 1 })))
  await waitFor(() => expect(document.querySelector('.xp-slot-chrome .xp-ui-status--running')).toBeTruthy())
})

test('a delayed old editor read cannot overwrite Start from the panel', async () => {
  const fetcher = setup()
  const { drawer } = await open()
  const start = await within(drawer).findByRole('button', { name: 'Start' })
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
  let finish!: (response: Response) => void
  const stale = { ...saved }
  const original = fetcher.getMockImplementation()!
  let hold = true
  fetcher.mockImplementation((url, init) => {
    if (hold && url.includes('/xp-experiments/') && !init?.method) { hold = false; return new Promise<Response>(resolve => { finish = resolve }) }
    return original(url, init)
  })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(start)
  await waitFor(() => expect(document.querySelector('.xp-slot-chrome .xp-ui-status--running')).toBeTruthy())
  await act(async () => finish(response(stale)))
  expect(document.querySelector('.xp-slot-chrome .xp-ui-status--running')).toBeTruthy()
})


test('an empty draft loads full manager setup with zero host wiring and no results request', async () => {
  const fetcher = setup()
  const { drawer } = await open('sidebar')
  expect(await within(drawer).findByLabelText('Test name')).toBeTruthy()
  expect(within(drawer).getByRole('button', { name: 'Start' })).toBeTruthy()
  expect(fetcher.mock.calls.some(([url]) => url.includes('/results'))).toBe(false)
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/xp/editor-surface'))).toHaveLength(1)
})

test.each([401, 403, 500])('surface failure %s explains access or offers setup recovery and Retry', async status => {
  const fetcher = setup()
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation((url, init) => url.endsWith('/xp/editor-surface') ? Promise.resolve(response({}, status)) : original(url, init))
  const { drawer } = await open()
  expect(await within(drawer).findByText(status === 500 ? "Setup isn't available right now." : "You don't have access to this test.")).toBeTruthy()
  expect(within(drawer).queryByLabelText('Test name')).toBeNull()
  expect(within(drawer).getByRole('link', { name: 'Open in a new tab' }).getAttribute('href')).toBe(`/manage/experiments/${base.id}`)
  if (status === 500) {
    expect(within(drawer).getByRole('link', { name: 'Open in a new tab' }).className).toContain('xp-ui-button--primary')
    fetcher.mockImplementation(original)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Retry' }))
    expect(await within(drawer).findByLabelText('Test name')).toBeTruthy()
  }
})

test('panel leaves the editor goal query untouched', async () => {
  window.history.replaceState({}, '', '/editor?goal=2')
  const fetcher = setup()
  const { drawer } = await open()
  await within(drawer).findByLabelText('Goal')
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('/xp-metrics'))).toBe(true))
  await act(async () => {})
  expect(window.location.search).toBe('?goal=2')
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  window.history.replaceState({}, '', '/')
})

test('a name save preserves loaded results, while a phase or status transition reloads them', async () => {
  const fetcher = setup('running')
  const { drawer } = await open()
  await within(drawer).findByRole('table', { name: 'Registrations' })
  const before = fetcher.mock.calls.filter(([url]) => url.includes('/results')).length
  const name = within(drawer).getByLabelText('Test name')
  fireEvent.change(name, { target: { value: 'Renamed' } }); fireEvent.blur(name)
  await waitFor(() => expect(document.querySelector('.xp-slot-title')?.textContent).toBe('Renamed'))
  expect(fetcher.mock.calls.filter(([url]) => url.includes('/results'))).toHaveLength(before)
  fireEvent.click(within(drawer).getByRole('button', { name: 'Stop' }))
  const confirmation = screen.getAllByRole('dialog').find(dialog => dialog !== drawer)!
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Stop' }))
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.includes('/results')).length).toBeGreaterThan(before))
})

test('selecting text inside and releasing on the backdrop keeps the panel open', async () => {
  setup()
  const { drawer } = await open()
  const name = await within(drawer).findByLabelText('Test name')
  fireEvent.pointerDown(name, { clientX: 10, clientY: 10 })
  fireEvent.pointerUp(drawer, { clientX: -10, clientY: -10 })
  fireEvent.click(drawer, { clientX: -10, clientY: -10 })
  expect(screen.getByRole('dialog')).toBe(drawer)
  fireEvent.pointerDown(drawer, { clientX: -10, clientY: -10 })
  fireEvent.pointerUp(name, { clientX: 10, clientY: 10 })
  fireEvent.click(drawer, { clientX: -10, clientY: -10 })
  expect(screen.getByRole('dialog')).toBe(drawer)
})

test('concurrent panel mounts share one pending setup read and show quiet loading', async () => {
  let finish!: (response: Response) => void
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', fetcher)
  const routes = { api: '/session-api', admin: '/manage' }
  render(<><ConfigureTestDrawer id="one" routes={routes} onClose={vi.fn()} /><ConfigureTestDrawer id="two" routes={routes} onClose={vi.fn()} /></>)
  expect(screen.getAllByRole('status').every(node => node.textContent === 'Loading test…')).toBe(true)
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('/session-api/xp/editor-surface', { credentials: 'include', cache: 'no-store' })
  await act(async () => finish(response({}, 403)))
  expect(screen.getAllByText("You don't have access to this test.")).toHaveLength(2)
})

test('setup reads share the response body as well as the headers', async () => {
  let finish!: (data: unknown) => void
  const fetcher = vi.fn(async () => ({ ok: true, status: 200,
    json: () => new Promise(resolve => { finish = resolve }),
  }))
  vi.stubGlobal('fetch', fetcher)
  const routes = { api: '/slow-body', admin: '/manage' }
  const one = <ConfigureTestDrawer id="one" routes={routes} onClose={vi.fn()} />
  const view = render(one)
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  view.rerender(<>{one}<ConfigureTestDrawer id="two" routes={routes} onClose={vi.fn()} /></>)
  expect(fetcher).toHaveBeenCalledOnce()
  // A malformed completed body takes the same ordinary recovery path in both mounts.
  await act(async () => finish({}))
  expect(screen.getAllByText("Setup isn't available right now.")).toHaveLength(2)
  view.unmount()
  render(one)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  await act(async () => finish({}))
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, useGetPuck, type Config, type Data } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
// These rendering/selection scenarios use a known manager. Access loading and
// denial use the real hook in permissions.test.tsx.
vi.mock('../../../src/puck/editor/editorSurface.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/puck/editor/editorSurface.js')>(),
  useEditorSurface: () => ({ surface: { canManage: true, canReadResults: true } }),
}))

const config: Config = { components: {
  ExperimentSlot: ExperimentSlotEditor,
  Text: { render: ({ text }) => <p>{text}</p> },
  Container: { fields: { children: { type: 'slot' } }, render: ({ children: Children }) => <div><Children /></div> },
  Legacy: { render: ({ puck }) => <>{puck.renderDropZone({ zone: 'legacy' })}</> },
} }
const block = (id: string) => ({ type: 'ExperimentSlot', props: { id, experiment: { id: 'sharing-test', slug: 'test' }, control: [], variantA: [], variantB: [], variantC: [] } })
const doc = { name: 'Shared test', status: 'running', arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 50 }, { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50 }] }
const placement = { collection: 'pages', id: 'saved', title: 'Page', ok: true, detail: 'Published' }
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  window.history.replaceState({}, '', '/admin/puck-editor/pages/create')
})
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function mount(data: Data) { return render(<Puck config={config} data={data} iframe={{ enabled: false }}><Puck.Preview /></Puck>) }
const notice = 'This test is also used in another place. Changes here affect that test.'
function fetchPlacements(placements: unknown, status = 200) {
  const placementsRead = vi.fn(async () => new Response(JSON.stringify({ placements }), { status }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preflight') ? placementsRead() : new Response(JSON.stringify(doc))))
  return placementsRead
}
test('unsaved page and one saved placement elsewhere are shared', async () => {
  fetchPlacements([placement])
  mount({ root: { props: {} }, content: [block('only')] })
  await screen.findByText(notice)
  await screen.findByRole('heading', { name: 'Shared test' })
  expect(screen.getByRole('button', { name: 'Remove the test from this block' })).toBeTruthy()
})
test.each([false, true])('one placement on this saved page is not shared (custom route: %s)', async custom => {
  window.history.replaceState({}, '', custom ? '/manage-content/page/saved' : '/admin/puck-editor/pages/saved')
  fetchPlacements([{ ...placement, editorUrl: custom ? '/manage-content/page/saved?draft=true' : undefined }])
  mount({ root: { props: {} }, content: [block('only')] })
  await screen.findByRole('heading', { name: 'Shared test' })
  await screen.findByText('Stop the test to remove it from this block.')
  expect(screen.queryByText(notice)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Remove the test from this block' })).toBeNull()
  expect(screen.getByText('Stop the test to remove it from this block.')).toBeTruthy()
})
test.each(['root', 'nested', 'zone'] as const)('two live blocks are shared with no saved placements (%s)', async location => {
  fetchPlacements([])
  mount({ root: { props: {} }, content: [block('one'), location === 'root' ? block('two') : location === 'nested'
    ? { type: 'Container', props: { id: 'container', children: [block('two')] } } : { type: 'Legacy', props: { id: 'legacy' } }],
    zones: location === 'zone' ? { 'legacy:legacy': [block('two')] } : undefined })
  await waitFor(() => expect(screen.getAllByText(notice)).toHaveLength(2))
})
test.each(['403', 'network'].flatMap(failure => [1, 2].map(count => ({ failure, count }))))('placement $failure gives no server knowledge ($count local blocks)', async ({ failure, count }) => {
  const read = fetchPlacements([placement], failure === '403' ? 403 : 200)
  if (failure === 'network') read.mockRejectedValue(new Error('offline'))
  mount({ root: { props: {} }, content: Array.from({ length: count }, (_, index) => block(String(index))) })
  await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Shared test' })).toHaveLength(count))
  if (count > 1) expect(screen.getAllByText(notice)).toHaveLength(count)
  else expect(screen.queryByText(notice)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(read).toHaveBeenCalledOnce()
})
test('blocks share pending placement reads, a late RUNNING block refreshes settled knowledge, and visibility return does not refetch', async () => {
  let complete!: (response: Response) => void
  const reads = vi.fn(() => new Promise<Response>(resolve => { complete = resolve }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preflight') ? reads() : new Response(JSON.stringify(doc))))
  let getPuck!: ReturnType<typeof useGetPuck>
  function Probe() { getPuck = useGetPuck(); return <button onClick={() => {
    const { appState, dispatch } = getPuck()
    dispatch({ type: 'setData', data: { ...appState.data, content: [...appState.data.content, block('three')] } })
  }}>Add</button> }
  render(<Puck config={config} data={{ root: { props: {} }, content: [block('one'), block('two')] }} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
  await waitFor(() => expect(reads).toHaveBeenCalledOnce())
  await act(async () => { complete(new Response(JSON.stringify({ placements: [placement] }))) })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(reads).toHaveBeenCalledTimes(2))
  await act(async () => { complete(new Response(JSON.stringify({ placements: [placement] }))) })
  await waitFor(() => expect(screen.getAllByText(notice)).toHaveLength(3))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  await act(async () => {})
  expect(reads).toHaveBeenCalledTimes(2)
  // Server sharing remains after local sharing goes away, including across a document refetch.
  act(() => getPuck().dispatch({ type: 'setData', data: { root: { props: {} }, content: [block('one')] } }))
  await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Shared test' })).toHaveLength(1))
  expect(getPuck().appState.data.content.map(item => item.props.id)).toEqual(['one'])
  expect(screen.getByText(notice)).toBeTruthy()
})
test('RUNNING single placement cannot detach while loading or after a failed status read', async () => {
  let reject!: (reason: Error) => void
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/preflight') ? Promise.resolve(new Response(JSON.stringify({ placements: [] }))) : new Promise((_, fail) => { reject = fail })))
  mount({ root: { props: {} }, content: [block('only')] })
  expect(screen.queryByRole('button', { name: 'Remove the test from this block' })).toBeNull()
  await act(async () => reject(new Error('offline')))
  await screen.findByText("Couldn't load this test. Try again.")
  expect(screen.queryByRole('button', { name: 'Remove the test from this block' })).toBeNull()
})

test('the right block posts mirrored arms with holdout and content gaps and keeps both blocks’ content intact', async () => {
  let posted: Record<string, unknown> | undefined
  const old = { ...doc, status: 'draft', targeting: [{ old: true }], metrics: { primary: 9 }, decision: { winnerArm: 'variantC' }, arms: [
    { key: 'control', kind: 'control', label: 'Current page', weight: 80 },
    { key: 'variantC', kind: 'variant', label: 'Last idea', weight: 5 },
    { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 15 },
  ] }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posted = JSON.parse(String(init.body)); return new Response(JSON.stringify({ doc: { id: 'created', slug: 'page' } })) }
    return new Response(JSON.stringify(url.includes('where[slug]') ? { docs: [] } : url.endsWith('/preflight') ? { placements: [] } : url.includes('/created?') ? { ...posted, status: 'draft' } : old))
  }))
  const right = { ...block('right'), props: { ...block('right').props, variantB: [{ type: 'Text', props: { id: 'b-content', text: 'Keep B' } }] } }
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: { title: 'Page' } }, content: [block('left'), right] }} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
  await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Shared test' })).toHaveLength(2))
  const before = structuredClone(read().appState.data)
  fireEvent.click(within(document.querySelectorAll<HTMLElement>('.xp-slot-chrome')[1]!).getByRole('button', { name: 'Start a new test from this block' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start a new test from this block' }))
  await waitFor(() => expect(read().getItemById('right')?.props.experiment.id).toBe('created'))
  expect(posted).toEqual({ name: 'Page', slug: 'page', kind: 'block', unitType: 'visitor', exposurePolicy: 'render', allocation: 100, analysis: { plannedDurationDays: 28 }, arms: [
    { key: 'control', kind: 'control', slot: 'control', label: 'Current page', weight: 34 },
    { key: 'variantB', kind: 'variant', slot: 'variantB', label: 'Variant B', weight: 33 },
    { key: 'variantC', kind: 'variant', slot: 'variantC', label: 'Last idea', weight: 33 },
  ] })
  expect(read().getItemById('left')).toEqual(before.content[0])
  expect(read().getItemById('right')).toEqual({ ...before.content[1], props: { ...before.content[1]!.props, experiment: { id: 'created', slug: 'page' } } })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('a status refresh closes an ineligible detach confirmation before it can change a RUNNING sole placement', async () => {
  let status = 'draft'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/preflight') ? { placements: [] } : { ...doc, status }))))
  mount({ root: { props: {} }, content: [block('only')] })
  fireEvent.click(await screen.findByRole('button', { name: 'Remove the test from this block' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  status = 'running'
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByText('Stop the test to remove it from this block.')).toBeTruthy()
})


test('RUNNING shows no detach action or stop sentence until placements settle', async () => {
  let complete!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preflight') ? new Promise<Response>(resolve => { complete = resolve }) : new Response(JSON.stringify(doc))))
  mount({ root: { props: {} }, content: [block('only')] })
  await screen.findByRole('heading', { name: 'Shared test' })
  expect(screen.queryByText('Stop the test to remove it from this block.')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Remove the test from this block' })).toBeNull()
  await waitFor(() => expect(complete).toBeTypeOf('function'))
  await act(async () => complete(new Response(JSON.stringify({ placements: [] }))))
  await screen.findByText('Stop the test to remove it from this block.')
})

test.each(['offer', 'confirm', 'failure'] as const)('RUNNING rechecks stale shared placements before detach: %s', async stage => {
  window.history.replaceState({}, '', '/admin/puck-editor/pages/saved')
  let reads = 0
  const placementsRead = vi.fn(async () => {
    reads++
    if (reads === 1 || stage === 'confirm' && reads === 2) return new Response(JSON.stringify({ placements: [placement, { ...placement, id: 'elsewhere' }] }))
    if (stage === 'failure') throw new Error('offline')
    return new Response(JSON.stringify({ placements: [placement] }))
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preflight') ? placementsRead() : new Response(JSON.stringify(doc))))
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: {} }, content: [block('only')] }} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
  const detach = await screen.findByRole('button', { name: 'Remove the test from this block' })
  fireEvent.click(detach)
  if (stage === 'confirm') {
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the test from this block' }))
  }
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await screen.findByText(stage === 'failure' ? "Couldn't check where this test is used. Try again." : 'Stop the test to remove it from this block.', { selector: '[role="alert"], [role="alert"] *' })
  expect(read().getItemById('only')?.props.experiment).toEqual(block('only').props.experiment)
  expect(placementsRead).toHaveBeenCalledTimes(stage === 'confirm' ? 3 : 2)
})

test.each(['offer', 'confirm'] as const)('stale DRAFT cache reads current RUNNING status before detach %s', async stage => {
  window.history.replaceState({}, '', '/admin/puck-editor/pages/saved')
  let status = 'draft'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/preflight') ? { placements: [placement] } : { ...doc, status }))))
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: {} }, content: [block('only')] }} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
  const button = await screen.findByRole('button', { name: 'Remove the test from this block' })
  if (stage === 'offer') status = 'running'
  fireEvent.click(button)
  if (stage === 'confirm') {
    const dialog = await screen.findByRole('dialog')
    status = 'running'
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the test from this block' }))
  }
  await screen.findByText('Stop the test to remove it from this block.', { selector: '[role="alert"], [role="alert"] *' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(read().getItemById('only')?.props.experiment).toEqual(block('only').props.experiment)
  const reads = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/xp-experiments/'))
  expect(reads).toHaveLength(stage === 'confirm' ? 3 : 2)
})

test.each(['draft', 'stopped', 'decided', 'archived'] as const)('a page editor can detach a %s test without placement permission', async status => {
  const placementsRead = vi.fn(async () => new Response('{}', { status: 403 }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preflight') ? placementsRead() : Response.json({ ...doc, status })))
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: {} }, content: [block('only')] }} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
  const button = await screen.findByRole('button', { name: 'Remove the test from this block' })
  await waitFor(() => expect(placementsRead).toHaveBeenCalledOnce())
  fireEvent.click(button)
  const dialog = await screen.findByRole('dialog')
  expect(placementsRead).toHaveBeenCalledOnce()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the test from this block' }))
  await waitFor(() => expect(read().getItemById('only')?.props.experiment).toBeNull())
  expect(screen.queryByRole('alert')).toBeNull()
  // Successful binding removal invalidates sharing for other mounted blocks.
  expect(placementsRead).toHaveBeenCalledTimes(2)
})

test.each(['offer', 'confirm'] as const)('a test deleted before detach %s can still be removed from its block', async stage => {
  let deleted = false
  const placementsRead = vi.fn(async () => Response.json({ placements: [placement] }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preflight') ? placementsRead()
    : deleted ? new Response('{}', { status: 404 }) : Response.json(doc)))
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: {} }, content: [block('only')] }} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
  const button = await screen.findByRole('button', { name: 'Remove the test from this block' })
  if (stage === 'offer') deleted = true
  fireEvent.click(button)
  const dialog = await screen.findByRole('dialog')
  deleted = true
  const before = placementsRead.mock.calls.length
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the test from this block' }))
  await waitFor(() => expect(read().getItemById('only')?.props.experiment).toBeNull())
  expect(screen.queryByRole('alert')).toBeNull()
  // Only the post-detach cache invalidation refreshes placements.
  expect(placementsRead).toHaveBeenCalledTimes(before + 1)
})

test.each(['403', 'network'] as const)('RUNNING refuses detach when fresh placements fail with %s, even with another local block', async failure => {
  let fail = false
  const placementsRead = vi.fn(async () => {
    if (!fail) return Response.json({ placements: [] })
    if (failure === 'network') throw new Error('offline')
    return new Response('{}', { status: 403 })
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preflight') ? placementsRead() : Response.json(doc)))
  let read!: ReturnType<typeof useGetPuck>
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: {} }, content: [block('one'), block('two')] }} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove the test from this block' })).toHaveLength(2))
  const before = placementsRead.mock.calls.length
  fail = true
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove the test from this block' })[0]!)
  await screen.findByText("Couldn't check where this test is used. Try again.")
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(read().getItemById('one')?.props.experiment).toEqual(block('one').props.experiment)
  expect(placementsRead).toHaveBeenCalledTimes(before + 1)
})

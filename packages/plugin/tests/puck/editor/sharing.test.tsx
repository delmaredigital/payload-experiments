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
  const placementsRead = vi.fn(async () => new Response(JSON.stringify({ placements, checks: [] }), { status }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preflight') ? placementsRead() : new Response(JSON.stringify(doc))))
  return placementsRead
}
test('unsaved page and one saved placement elsewhere are shared', async () => {
  fetchPlacements([placement])
  mount({ root: { props: {} }, content: [block('only')] })
  await screen.findByText(notice)
  await screen.findByRole('heading', { name: 'Shared test' })
})
test.each([false, true])('one placement on this saved page is not shared (custom route: %s)', async custom => {
  window.history.replaceState({}, '', custom ? '/manage-content/page/saved' : '/admin/puck-editor/pages/saved')
  fetchPlacements([{ ...placement, editorUrl: custom ? '/manage-content/page/saved?draft=true' : undefined }])
  mount({ root: { props: {} }, content: [block('only')] })
  await screen.findByRole('heading', { name: 'Shared test' })
  expect(screen.queryByText(notice)).toBeNull()
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
  expect(await screen.findAllByText(failure === '403' ? "You don't have permission to check where this test is used." : "Couldn't check readiness. Try again.")).toHaveLength(count)
  if (failure === '403') expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  expect(screen.getAllByRole('alert')).toHaveLength(count)
  expect(read).toHaveBeenCalledOnce()
})
test('blocks share pending placement reads, a late RUNNING block reuses settled knowledge, and visibility return does not refetch', async () => {
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
  await act(async () => { complete(new Response(JSON.stringify({ checks: [], placements: [placement] }))) })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await act(async () => {})
  expect(reads).toHaveBeenCalledOnce()
  await waitFor(() => expect(screen.getAllByText(notice)).toHaveLength(3))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  await act(async () => {})
  expect(reads).toHaveBeenCalledOnce()
  // Server sharing remains after local sharing goes away, including across a document refetch.
  act(() => getPuck().dispatch({ type: 'setData', data: { root: { props: {} }, content: [block('one')] } }))
  await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Shared test' })).toHaveLength(1))
  expect(getPuck().appState.data.content.map(item => item.props.id)).toEqual(['one'])
  expect(screen.getByText(notice)).toBeTruthy()
})

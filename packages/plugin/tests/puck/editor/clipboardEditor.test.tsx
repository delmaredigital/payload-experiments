// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, useGetPuck, type ComponentData, type Config, type Data } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { editorCopy } from '../../../src/puck/editor/copy.js'

import { defaultArms } from '../../../src/arms/model.js'
import { localPlacements } from '../../../src/puck/editor/localPlacements.js'
import { walkVisiblePuck } from '../../../src/puck/visibility.js'
import { preflightData } from '../../../src/transitions/preflightData.js'
import { placementPages } from '../../../src/lib/placementPages.js'
import { PreviewLinks } from '../../../src/testSurface/PreviewLinks.js'
import { resolveExperimentData } from '../../../src/server/resolveExperimentData.js'
import { blockRemovalRule } from '../../../src/hooks/blockRemovalRule.js'
import { fakePayload } from '../../_fakes/payload.js'
import { fakeReq } from '../../_fakes/req.js'
import { sampleOptions } from '../../collections/fixtures.js'
import { assignments } from '../../rsc/helpers.js'

// payload-puck 0.12.1's public /editor exports hook types, not clipboard operations.
// Use its internal createEditorClipboard/copyBlock/pasteBlock and test reset to
// exercise the action bar and keyboard operation with a real Puck API.
const { createEditorClipboard, copyBlock, pasteBlock, resetClipboardStoresForTests } = await import(
  new URL('../clipboard/editor.js', import.meta.resolve('@delmaredigital/payload-puck/editor')).href
)
const config: Config = { components: {
  ExperimentSlot: ExperimentSlotEditor,
  Container: { fields: { children: { type: 'slot' } }, render: ({ children: Children }) => <Children /> },
  Text: { render: ({ text }) => <p>{text}</p> },
} }
const experiment = (id: string): ComponentData => ({ type: 'ExperimentSlot', props: { id, experiment: null, control: [], variantA: [], variantB: [], variantC: [] } })
const container = (id: string, children: ComponentData[]): ComponentData => ({ type: 'Container', props: { id, children } })
let getPuck!: ReturnType<typeof useGetPuck>
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) }, clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null, get length() { return values.size } }
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.history.replaceState({}, '', '/admin/puck-editor/pages/source-page')
  resetClipboardStoresForTests()
  vi.stubGlobal('sessionStorage', storage())
  vi.stubGlobal('localStorage', storage())
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ canManage: true, canReadResults: true })))
})
afterEach(async () => { cleanup(); await act(async () => {}); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })
function mount(data: Data, fields = false) {
  function Probe() { getPuck = useGetPuck(); return null }
  render(<Puck config={config} data={data} iframe={{ enabled: false }}><Puck.Preview />{fields ? <Puck.Fields /> : null}<Probe /></Puck>)
}
async function copied(block: ComponentData) {
  const clipboard = createEditorClipboard()
  await waitFor(() => expect(clipboard.store()).toBeDefined())
  expect(copyBlock(block, clipboard)).toBe(true)
  return clipboard
}
test.each(['self', 'tree'] as const)('real paste path refuses a %s beneath an Experiment through containers', async mode => {
  const outer = experiment('outer')
  outer.props.control = [container('inside', [])]
  mount({ root: { props: {} }, content: [outer] })
  const clipboard = await copied(mode === 'self' ? experiment('copied') : container('copy-container', [container('deeper', [experiment('copied')])]))
  const before = structuredClone(getPuck().appState.data)
  let pasted!: boolean
  act(() => { pasted = pasteBlock(getPuck(), 'inside:children', 0, clipboard) })
  expect(pasted).toBe(false)
  expect(clipboard.status.read().message).toBe(editorCopy.nestedPaste)
  expect(getPuck().appState.data).toEqual(before)
})
test('real paste path refuses an Experiment directly inside outer:control', async () => {
  mount({ root: { props: {} }, content: [experiment('outer')] })
  const clipboard = await copied(experiment('copied'))
  const before = structuredClone(getPuck().appState.data)
  act(() => { expect(pasteBlock(getPuck(), 'outer:control', 0, clipboard)).toBe(false) })
  expect(getPuck().appState.data).toEqual(before)
  // payload-puck checks the slot's disallow before asking component hooks.
  expect(clipboard.status.read().message).toBe("Experiment block blocks aren't allowed in Original.")
})
test('real paste path permits ordinary content inside an Experiment version', async () => {
  mount({ root: { props: {} }, content: [experiment('outer')] })
  const clipboard = await copied(container('copy-container', [{ type: 'Text', props: { id: 'text', text: 'Content' } }]))
  act(() => { expect(pasteBlock(getPuck(), 'outer:control', 0, clipboard)).toBe(true) })
  await waitFor(() => expect(getPuck().getItemById('outer')!.props.control).toHaveLength(1))
  const pasted = getPuck().getItemById('outer')!.props.control[0]
  expect(pasted.type).toBe('Container')
  expect(pasted.props.children[0].props.text).toBe('Content')
})

const bound = (id: string): ComponentData => ({ ...experiment(id), props: { ...experiment(id).props,
  experiment: { id: 7, slug: 'hero' }, control: [{ type: 'Text', props: { id: `${id}-original`, text: 'Original' } }],
  variantA: [{ type: 'Text', props: { id: `${id}-variant`, text: 'Variant' } }], _visibility: { hideOn: ['phone'] },
} })
const sharedNotice = 'This test is also used in another place. Changes here affect that test.'
const savedSource = { collection: 'pages', id: 'source-page', title: 'Source', ok: true, detail: 'Published' }
function readsForBoundTest(placements = [savedSource], status = 'draft') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/editor-surface') ? { canManage: true, canReadResults: true }
    : url.endsWith('/preflight') ? { checks: [], placements } : url.endsWith('/results') || url.includes('/summary?') ? {} : {
      name: 'Shared clipboard test', status, arms: defaultArms('block'),
    })))
}
async function readiness(pages: Array<{ id: string; puckData: Data }>) {
  const options = { ...sampleOptions(), puck: { enabled: true, collections: ['pages'] }, admin: { editorUrl: ({ collection, id }: { collection: string; id: string | number }) => `/admin/puck-editor/${collection}/${id}` } }
  const payload = fakePayload({ config: { custom: { xp: options }, collections: [{ slug: 'pages', versions: false }] }, collections: {
    pages: pages.map(page => ({ ...page, title: page.id, _status: 'published' })),
    'xp-experiments': [{ id: 7, slug: 'hero', name: 'Shared clipboard test', kind: 'block', status: 'draft', unitType: 'visitor',
      allocation: 100, exposurePolicy: 'render', arms: defaultArms('block'), metrics: { primary: 1 }, analysis: { plannedDurationDays: 14 } }],
    'xp-metrics': [{ id: 1, name: 'Signup', source: 'events:signup' }],
  } })
  const req = fakeReq({ payload })
  const answer = await preflightData(req, { experimentId: 7, options })
  expect(answer).not.toBeNull()
  expect(answer!.checks.filter(check => !check.ok)).toEqual([])
  return { answer: answer!, payload, req, options }
}

test('paste and Puck Duplicate keep the same binding, refresh all block ids and count every visible copy', async () => {
  window.history.replaceState({}, '', '/admin/puck-editor/pages/source-page')
  readsForBoundTest()
  mount({ root: { props: {} }, content: [bound('original')] })
  await screen.findByRole('heading', { name: 'Shared clipboard test' })
  const clipboard = await copied(getPuck().getItemById('original')!)
  act(() => getPuck().dispatch({ type: 'duplicate', sourceIndex: 0, sourceZone: 'root:default-zone' }))
  act(() => { expect(pasteBlock(getPuck(), 'root:default-zone', 2, clipboard)).toBe(true) })
  await waitFor(() => expect(screen.getAllByText(sharedNotice)).toHaveLength(3))
  const data = getPuck().appState.data
  expect(data.content).toHaveLength(3)
  const ids: string[] = []
  walkVisiblePuck(data, block => ids.push(String(block.props.id)))
  expect(new Set(ids).size).toBe(9)
  for (const block of data.content) {
    expect(block.props.experiment).toEqual({ id: 7, slug: 'hero' })
    expect(block.props._visibility).toEqual({ hideOn: ['phone'] })
  }
  expect(localPlacements(data).get('7')?.size).toBe(3)
  expect(fetch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }))
  const { answer } = await readiness([{ id: 'source-page', puckData: data }])
  expect(answer.placements).toHaveLength(3)
  expect(placementPages(answer.placements).map(page => page.slotCount)).toEqual([3])
  const view = render(<PreviewLinks experimentId={7} apiRoute="/api" arms={defaultArms('block')} placements={answer.placements} />)
  expect(within(view.container).getByText(/placed 3 times on this page/)).toBeTruthy()
  expect(resolveExperimentData(data, assignments()).rendered).toEqual([{ slug: 'hero', phase: 1, arm: 'variantA' }])
})

test.each(['draft', 'running'])('cross-page paste of a %s test keeps its binding and shows sharing plus unsaved-page guidance', async status => {
  readsForBoundTest([savedSource], status)
  const source = { root: { props: {} }, content: [bound('original')] }
  mount(source)
  const clipboard = await copied(getPuck().getItemById('original')!)
  cleanup()
  await act(async () => {})
  window.history.replaceState({}, '', '/admin/puck-editor/pages/destination-page')
  mount({ root: { props: {} }, content: [] })
  act(() => { expect(pasteBlock(getPuck(), 'root:default-zone', 0, clipboard)).toBe(true) })
  await screen.findByText(sharedNotice)
  await screen.findByText(status === 'running' ? "This test is running, but visitors won't see it here until this page is saved and published." : 'Save this page to put the test on it.')
  const destination = getPuck().appState.data
  expect(destination.content[0]!.props.experiment).toEqual({ id: 7, slug: 'hero' })
  const { answer, req } = await readiness([{ id: 'source-page', puckData: source }, { id: 'destination-page', puckData: destination }])
  expect(answer.placements.map(page => page.id)).toEqual(['source-page', 'destination-page'])
  expect(placementPages(answer.placements).map(page => page.slotCount)).toEqual([1, 1])
  const runningTest = { id: 7, slug: 'hero', name: 'Shared clipboard test', kind: 'block', status: 'running', phase: 1, arms: [], pageCollection: null, placementDocs: null }
  const removed = await blockRemovalRule.prepare(req, 'pages', { puckData: source }, { puckData: { root: { props: {} }, content: [] } }, false, undefined, [runningTest])
  await expect(blockRemovalRule.check(req, [runningTest], removed.affected, 'pages', 'source-page', false, removed.views)).resolves.toBeUndefined()
})

test('a cross-page paste inside a hidden container is hidden to readiness and cannot replace the last running placement', async () => {
  readsForBoundTest()
  const source = { root: { props: {} }, content: [bound('original')] }
  mount(source)
  const clipboard = await copied(getPuck().getItemById('original')!)
  cleanup()
  await act(async () => {})
  window.history.replaceState({}, '', '/admin/puck-editor/pages/destination-page')
  const hidden = container('hidden-parent', [])
  hidden.props._visibility = { hidden: true }
  mount({ root: { props: {} }, content: [hidden] })
  act(() => { expect(pasteBlock(getPuck(), 'hidden-parent:children', 0, clipboard)).toBe(true) })
  await screen.findByText(editorCopy.hidden)
  expect(screen.queryByText('Save this page to put the test on it.')).toBeNull()
  const destination = getPuck().appState.data
  expect(localPlacements(destination).size).toBe(0)
  expect(resolveExperimentData(destination, assignments()).rendered).toEqual([])
  const { answer, req, payload, options } = await readiness([{ id: 'source-page', puckData: source }, { id: 'destination-page', puckData: destination }])
  expect(answer.placements.map(page => page.id)).toEqual(['source-page'])
  const test = { id: 7, slug: 'hero', name: 'Shared clipboard test', kind: 'block', status: 'running', phase: 1, arms: [], pageCollection: null, placementDocs: null }
  req.transactionID = 'clipboard-test'
  const removed = await blockRemovalRule.prepare(req, 'pages', { puckData: source }, { puckData: { root: { props: {} }, content: [] } }, false, undefined, [test])
  await expect(blockRemovalRule.check(req, [test], removed.affected, 'pages', 'source-page', false, removed.views)).rejects.toMatchObject({ code: 'locked-placement' })
  payload.documents.pages = payload.documents.pages!.filter(page => page.id !== 'source-page')
  const hiddenOnly = await preflightData(fakeReq({ payload }), { experimentId: 7, options })
  expect(hiddenOnly!.placements).toEqual([])
  expect(hiddenOnly!.checks).toContainEqual({ code: 'no-placements', ok: false })
})


test('an inner test shows one plain notice in the real editor', async () => {
  const outer = experiment('outer-notice')
  outer.props.control = [experiment('inner-notice')]
  mount({ root: { props: {} }, content: [outer] })
  expect(await screen.findByText(editorCopy.nested('Unconfigured test', 'Unconfigured test'))).toBeTruthy()
})

test('Puck public reducer insertion bypasses slot disallow, leaving the server as the final guard', async () => {
  mount({ root: { props: {} }, content: [experiment('outer-dispatch')] })
  act(() => { getPuck().dispatch({ type: 'insert', componentType: 'ExperimentSlot', destinationZone: 'outer-dispatch:control', destinationIndex: 0, id: 'inner-dispatch' }) })
  expect(getPuck().getItemById('inner-dispatch')?.type).toBe('ExperimentSlot')
  expect(await screen.findByText(editorCopy.nested('Unconfigured test', 'Unconfigured test'))).toBeTruthy()
})


test('a selected bound inner test keeps one sidebar notice while Start remains blocked', async () => {
  const message = editorCopy.nested('Outer test', 'Inner test')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/editor-surface') ? { canManage: true, canReadResults: true }
    : url.endsWith('/preflight') ? { checks: [{ code: 'nested-tests', ok: false, detail: [{ outer: 'Outer test', inner: 'Inner test' }] }], placements: [savedSource] }
    : { name: url.includes('/810?') ? 'Outer test' : 'Inner test', status: 'draft', arms: defaultArms('block') })))
  const inner = { ...bound('inner-sidebar'), props: { ...bound('inner-sidebar').props, experiment: { id: 811, slug: 'inner-sidebar' } } }
  const outer = { ...bound('outer-sidebar'), props: { ...bound('outer-sidebar').props, experiment: { id: 810, slug: 'outer-sidebar' }, control: [inner] } }
  mount({ root: { props: {} }, content: [outer] }, true)
  await screen.findByText(message)
  act(() => getPuck().dispatch({ type: 'setUi', ui: { itemSelector: getPuck().getSelectorForId('inner-sidebar')! } }))
  const sidebar = await waitFor(() => {
    const element = document.querySelector('.xp-slot-sidebar')
    expect(element).not.toBeNull()
    expect(within(element as HTMLElement).getAllByText(message)).toHaveLength(1)
    return element as HTMLElement
  })
  expect(within(sidebar).queryByRole('button', { name: 'Start' })).toBeNull()
  expect(within(sidebar).getByRole('button', { name: 'Configure test' })).toBeTruthy()
})

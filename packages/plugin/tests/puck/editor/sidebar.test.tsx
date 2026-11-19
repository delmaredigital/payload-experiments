// @vitest-environment jsdom
import '../../_helpers/popover.js'
import { changeField, openSelect } from '../../_helpers/select.js'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, useGetPuck, type Config } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { newTestBody } from '../../../src/puck/editor/editor.model.js'
import { publishExperiment } from '../../../src/puck/editor/armsCache.js'
import { editorCopy as C } from '../../../src/puck/editor/copy.js'
import { watchPlacementNotice } from '../../../src/puck/editor/placementsCache.js'
import { ConfigureTestDrawer } from '../../../src/puck/editor/ConfigureTestDrawer.js'
import { useArmWrites } from '../../../src/puck/editor/VersionBuilder.js'
import type { Status } from '../../../src/types/contracts.js'

const base = { ...newTestBody({ kind: 'block', name: 'Hero test', slug: 'hero', unitType: 'visitor' }), id: 'sidebar-test', status: 'draft' as Status, updatedAt: 'one' }
let doc: typeof base
let role: 'manager' | 'results' | 'none'
let failed: boolean
let testCode: number
let checks: Array<{ code: string; ok: boolean; detail?: unknown }>
let refusal: boolean
let read!: ReturnType<typeof useGetPuck>
const block = { type: 'ExperimentSlot', props: { id: 'sidebar-block', experiment: { id: 'sidebar-test', slug: 'hero' }, control: [], variantA: [], variantB: [], variantC: [] } }
const config: Config = { components: { ExperimentSlot: ExperimentSlotEditor, Text: { render: () => <p>Content</p> } } }
const reply = (value: unknown, status = 200) => Response.json(value, { status })
function fields() { return within(screen.getByTestId('sidebar')) }
function chrome() { return within(document.querySelector<HTMLElement>('.xp-slot-chrome')!) }
async function mount(unbound = false, leftover = false, unreadable = false) {
  function Probe() { read = useGetPuck(); return null }
  const actions: unknown[] = []
  render(<Puck config={config} data={{ root: { props: {} }, content: [{ ...block, props: { ...block.props, experiment: unbound ? null : block.props.experiment,
    variantC: leftover ? [{ type: 'Text', props: { id: 'leftover' } }] : [] } }] }} iframe={{ enabled: false }} onAction={action => {
    if (action.type === 'setUi' && 'itemSelector' in action.ui) actions.push(action)
  }}><Puck.Preview /><div data-testid="sidebar"><Puck.Fields /></div><Probe /></Puck>)
  await waitFor(() => expect(chrome().queryByText('Loading test…')).toBeNull())
  act(() => read().dispatch({ type: 'setUi', ui: { itemSelector: read().getSelectorForId('sidebar-block')! } }))
  await fields().findByRole('region', { name: 'Test' })
  if (!unbound && !unreadable && role === 'manager' && !failed && testCode === 200) await fields().findByRole('region', { name: C.versionsGroup })
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
    if (url.includes('/xp-metrics?')) return reply({ docs: [] })
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
afterEach(async () => { cleanup(); await act(async () => {}); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test.each(['draft', 'running', 'stopped', 'decided'] as const)('%s sidebar has ordered Test, Versions and collapsed More with the matching controls', async status => {
  doc.status = status
  await mount()
  expect(fields().getByRole('region', { name: C.testGroup })).toBeTruthy()
  expect(fields().getByRole('button', { name: C.moreGroup }).getAttribute('aria-expanded')).toBe('false')
  expect(fields().queryByRole('button', { name: C.differentTest })).toBeNull()
  const versions = fields().getByRole('region', { name: C.versionsGroup })
  expect(within(versions).getAllByRole('spinbutton')).toHaveLength(2)
  expect((within(versions).getByLabelText(C.weight('Original')) as HTMLInputElement).readOnly).toBe(status === 'running' || status === 'decided')
  expect(!!fields().queryByRole('button', { name: C.add })).toBe(status === 'draft' || status === 'stopped')
  expect(!!fields().queryByRole('button', { name: C.removeVersion })).toBe(status === 'draft' || status === 'stopped')
  const start = status === 'stopped' ? 'Start a new round' : 'Start'
  if (status === 'draft' || status === 'stopped') await fields().findByRole('button', { name: start })
  expect(!!fields().queryByRole('button', { name: start })).toBe(status === 'draft' || status === 'stopped')
  expect(!!fields().queryByRole('button', { name: 'Stop' })).toBe(status === 'running')
  expect(fields().queryByRole('button', { name: /Decide/ })).toBeNull()
  expect(fields().getByRole('button', { name: C.configure })).toBeTruthy()
})

test('compact cards use the name as their heading and keep matching actions together', async () => {
  await mount()
  const original = fields().getByRole('group', { name: 'Original' })
  expect(within(original).getByRole('button', { name: 'Show Original on the page' }).getAttribute('aria-pressed')).toBe('true')
  const variant = fields().getByRole('group', { name: 'Variant A' })
  expect(within(variant).queryByRole('button', { name: 'Variant A' })).toBeNull()
  const name = within(variant).getByRole('textbox', { name: 'Variant A Name' })
  act(() => name.focus())
  expect(screen.getByRole('tab', { name: 'Original' }).getAttribute('aria-selected')).toBe('true')
  expect(variant.getAttribute('data-active')).toBe('false')
  expect(document.activeElement).toBe(name)
  const copy = within(variant).getByRole('button', { name: C.copy('Original') })
  const remove = within(variant).getByRole('button', { name: C.removeVersion })
  expect(copy.parentElement).toBe(remove.parentElement)
  const add = fields().getByRole('button', { name: C.add })
  const split = fields().getByRole('button', { name: C.split })
  expect(add.parentElement).toBe(split.parentElement?.parentElement)
  for (const button of [copy, remove, add, split]) expect(button.classList.contains('xp-ui-button--secondary')).toBe(true)
})

test.each(['running', 'decided', 'archived'] as const)('%s locks announce attempted changes without moving focus or writing', async status => {
  doc.status = status
  await mount()
  const scroll = vi.fn()
  const notice = fields().getByText(C.locked[status]).closest<HTMLElement>('.xp-slot-lock-notice')!
  expect(notice).not.toBeNull()
  notice.scrollIntoView = scroll
  vi.useFakeTimers()
  expect(within(notice).queryByRole('alert')).toBeNull()
  const name = fields().getByRole<HTMLInputElement>('textbox', { name: 'Original Name' })
  const traffic = fields().getByRole<HTMLInputElement>('spinbutton', { name: C.weight('Original') })
  for (const input of [name, traffic]) {
    expect(input.readOnly).toBe(true)
    expect(input.getAttribute('aria-disabled')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain(notice.id)
    act(() => input.focus())
    fireEvent.keyDown(input, { key: '7' })
    expect(document.activeElement).toBe(input)
    expect(within(notice).getByRole('alert').textContent).toBe(C.locked[status])
    fireEvent.change(input, { target: { value: '7' } }); fireEvent.blur(input)
  }
  for (const label of [C.split]) {
    const button = fields().getByRole<HTMLButtonElement>('button', { name: label })
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    act(() => button.focus())
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(document.activeElement).toBe(button)
  }
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  expect(notice.getAttribute('data-attention')).toBe('true')
  fireEvent.click(name)
  act(() => { vi.advanceTimersByTime(2200) })
  expect(notice.getAttribute('data-attention')).toBe('false')
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toEqual([])
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(doc.arms.map(arm => arm.weight)).toEqual([50, 50])
  expect(doc.arms[0]!.label).toBe('Original')
})

test('sidebar edits and transitions update chrome without reload or Puck selection changes', async () => {
  const actions = await mount()
  const selected = read().appState.ui.itemSelector
  fireEvent.click(fields().getByRole('button', { name: C.add }))
  await screen.findByRole('tab', { name: 'Variant B' })
  expect(fields().getAllByRole('spinbutton')).toHaveLength(3)
  const input = fields().getByLabelText(C.weight('Original'))
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false))
  changeField(input, { target: { value: '60' } }); fireEvent.blur(input)
  await waitFor(() => expect(doc.arms[0]!.weight).toBe(60))
  const name = fields().getByRole('textbox', { name: 'Variant A Name' })
  changeField(name, { target: { value: 'New headline' } }); fireEvent.keyDown(name, { key: 'Enter' })
  await screen.findByRole('tab', { name: 'New headline' })
  await waitFor(() => expect((fields().getAllByRole('button', { name: C.removeVersion })[0] as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(fields().getAllByRole('button', { name: C.removeVersion })[0]!)
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
  else if (state === 'unavailable') expect(fields().getByText("The test for this block was deleted.")).toBeTruthy()
  else if (state === 'failed') {
    expect(fields().getByText("Couldn't load this test. Try selecting it again.")).toBeTruthy()
    failed = false; fireEvent.click(fields().getByRole('button', { name: C.retrySetup }))
    await fields().findByRole('region', { name: C.versionsGroup })
  } else {
    expect(fields().queryByRole('combobox')).toBeNull()
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
  expect(fields().getByText('Before you can start:')).toBeTruthy()
  expect(fields().getByText('Choose a goal.', { exact: false })).toBeTruthy()
  expect(fields().queryByRole('button', { name: 'Start' })).toBeNull()
  checks = []
  // The same chrome action refreshes shared readiness after writing.
  fireEvent.click(fields().getByRole('button', { name: C.split }))
  await fields().findByRole('button', { name: 'Start' })
  refusal = true
  fireEvent.click(fields().getByRole('button', { name: 'Start' }))
  expect((await fields().findByRole('alert')).textContent).toBe("You don't have permission to do this.")
  expect(document.body.textContent).not.toContain('PRIVATE')
})


test('Split evenly discards invalid traffic edits in the sidebar', async () => {
  await mount()
  const chromeInput = fields().getByLabelText(C.weight('Original'))
  changeField(chromeInput, { target: { value: '101' } })
  expect((fields().getByLabelText(C.weight('Original')) as HTMLInputElement).value).toBe('101')
  expect(fields().queryByRole('button', { name: 'Start' })).toBeNull()
  fireEvent.click(fields().getByRole('button', { name: C.split }))
  await waitFor(() => expect((chromeInput as HTMLInputElement).value).toBe('50'))
  expect(chrome().queryByRole('spinbutton')).toBeNull()
  expect(fields().queryByText(C.invalidShare)).toBeNull()
})


test('settled Start stays mounted across a delayed poll and focus refresh without checking flashes', async () => {
  await mount()
  const start = await fields().findByRole('button', { name: 'Start' })
  vi.useFakeTimers()
  const releaseNotice = watchPlacementNotice('/api', doc.id, document)
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight') ? new Promise(resolve => { finish = resolve }) : original(url, init))
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_001)
  fireEvent(window, new Event('focus'))
  expect(fields().queryByText('Before you can start: Checking readiness…')).toBeNull()
  expect(fields().getByRole('button', { name: 'Start' })).toBe(start)
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(fields().getByRole('button', { name: 'Start' })).toBe(start)
  await act(async () => { finish(reply({ checks: [], placements: [] })) })
  expect(fields().getByRole('button', { name: 'Start' })).toBe(start)
  releaseNotice()
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
  const trigger = fields().getByRole('button', { name: C.removeVersion })
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
  changeField(fields().getByLabelText(C.weight('Original')), { target: { value: '101' } })
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
  fireEvent.click(fields().getByRole('button', { name: C.removeVersion }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(C.removeScopeUnknown)).toBeTruthy()
  await act(async () => { finish(reply({ placements: [{ collection: 'pages', id: 'other', detail: 'Published' }], checks: [] })) })
  expect(within(dialog).getByText(C.removeShared)).toBeTruthy()
})


test('zero-content holdout removal uses only test wording and local sharing counts', async () => {
  doc.arms.push({ key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 })
  await mount()
  act(() => read().dispatch({ type: 'setData', data: { ...read().appState.data, content: [
    ...read().appState.data.content, { ...block, props: { ...block.props, id: 'second-block' } },
  ] } }))
  const versions = fields().getByRole('region', { name: C.versionsGroup })
  fireEvent.click(within(versions).getAllByRole('button', { name: C.removeVersion }).at(-1)!)
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('This removes the version from the test.')).toBeTruthy()
  expect(within(dialog).queryByText(/blocks|Save the page/)).toBeNull()
  expect(within(dialog).getByText(C.removeShared)).toBeTruthy()
})


test('removing an empty variant does not ask for a page save afterward', async () => {
  await mount()
  fireEvent.click(fields().getByRole('button', { name: C.removeVersion }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('This removes the version from the test.')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: C.remove }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByText(C.removed)).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Original' })))
  expect(read().getItemById('sidebar-block')?.props.variantA).toEqual([])
})


test.each([false, true])('a refused Start refreshes readiness and names the publishing step (drawer: %s)', async drawer => {
  if (drawer) render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  else await mount()
  const scope = drawer ? within(await screen.findByRole('dialog')) : fields()
  const start = await scope.findByRole('button', { name: 'Start' })
  const readsBefore = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/preflight')).length
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).endsWith('/start')) {
      checks = [{ code: 'placement-unpublished', ok: false, detail: [{ title: 'Landing' }] }]
      return Promise.resolve(reply({ errors: [{ code: 'placement-unpublished', message: 'The experiment is not ready to start.', detail: [{ title: 'Landing' }] }] }, 422))
    }
    return original(url, init)
  })
  fireEvent.click(start)
  const sentence = "The block you're testing is only on a draft of Landing. Publish the page before you start."
  // Sections also name their blockers; the footer/action area must not repeat its alert.
  const readiness = drawer ? within(scope.getByRole('region', { name: 'Readiness' })) : scope
  await readiness.findByText(sentence, { exact: false })
  expect(scope.queryByRole('alert')).toBeNull()
  expect(readiness.getAllByText(text => text.includes(sentence))).toHaveLength(1)
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/preflight')).length).toBe(readsBefore + 1)
  expect(scope.queryByText('Ready to start.')).toBeNull()
  if (drawer) expect((scope.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true)
  else expect(scope.queryByRole('button', { name: 'Start' })).toBeNull()
})


test.each([false, true])('a hanging post-refusal read releases saving, guards stale Start, and times out with Retry (drawer: %s)', async drawer => {
  vi.useFakeTimers()
  if (drawer) render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  else {
    function Probe() { read = useGetPuck(); return null }
    render(<Puck config={config} data={{ root: { props: {} }, content: [block] }} iframe={{ enabled: false }}
      ui={{ itemSelector: { index: 0, zone: 'root:default-zone' } }}><Puck.Preview /><div data-testid="sidebar"><Puck.Fields /></div><Probe /></Puck>)
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  const scope = drawer ? within(screen.getByRole('dialog')) : fields()
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).endsWith('/start')) return Promise.resolve(reply({ errors: [{ code: 'forbidden', message: 'PRIVATE' }] }, 403))
    if (String(url).endsWith('/preflight')) return new Promise(resolve => { finish = resolve })
    return original(url, init)
  })
  const start = scope.getByRole('button', { name: 'Start' })
  fireEvent.click(start)
  await act(async () => {})
  expect(scope.getByText("You don't have permission to do this.")).toBeTruthy()
  expect(scope.queryByText('Checking readiness…')).toBeNull()
  expect(scope.queryByText('Saving this change…')).toBeNull()
  if (drawer) expect(scope.getByText('Ready to start.')).toBeTruthy()
  fireEvent.click(start)
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/start'))).toHaveLength(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(scope.queryByText('Checking readiness…')).toBeNull()
  const failure = "Couldn't check readiness. Try again."
  expect(scope.getAllByText(failure).length).toBeGreaterThan(0)
  const retry = scope.getByRole('button', { name: /^(Retry|Try again)$/ }) as HTMLButtonElement
  expect(retry.disabled).toBe(false)
  // A late response cannot restore the stale, timed-out answer.
  await act(async () => { finish(reply({ placements: [], checks: [] })) })
  expect(scope.getAllByText(failure).length).toBeGreaterThan(0)
  vi.mocked(fetch).mockImplementation(original)
  fireEvent.click(retry)
  await act(async () => {})
  expect(scope.queryByText(failure)).toBeNull()
  expect(scope.getByRole('button', { name: 'Start' })).toBeTruthy()
})


test.each([false, true])('a named refusal with a ready reread stays visible until the next successful answer (drawer: %s)', async drawer => {
  if (drawer) render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  else await mount()
  const scope = drawer ? within(await screen.findByRole('dialog')) : fields()
  const start = await scope.findByRole('button', { name: 'Start' })
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/start')
    ? Promise.resolve(reply({ errors: [{ code: 'placement-unpublished', detail: [{ title: 'Landing' }, { title: 'Checkout' }] }] }, 422)) : original(url, init))
  fireEvent.click(start)
  const alert = await scope.findByRole('alert')
  expect(alert.textContent).toBe("The block you're testing is only on a draft of Landing. Publish the page before you start.\nThe block you're testing is only on a draft of Checkout. Publish the page before you start.")
  await act(async () => {})
  expect(scope.getByRole('alert')).toBe(alert)
})


test('a refused sidebar Start guards the open drawer throughout the shared reread', async () => {
  await mount()
  render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  const drawer = within(await screen.findByRole('dialog'))
  const drawerStart = await drawer.findByRole('button', { name: 'Start' }) as HTMLButtonElement
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).endsWith('/start')) return Promise.resolve(reply({ errors: [{ code: 'forbidden' }] }, 403))
    if (String(url).endsWith('/preflight')) return new Promise(resolve => { finish = resolve })
    return original(url, init)
  })
  fireEvent.click(fields().getByRole('button', { name: 'Start' }))
  await fields().findByText("You don't have permission to do this.")
  expect(drawerStart.disabled).toBe(true)
  expect(drawer.queryByText('Checking readiness…')).toBeNull()
  expect(drawer.getByText('Ready to start.')).toBeTruthy()
  fireEvent.click(drawerStart)
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/start'))).toHaveLength(1)
  await act(async () => { finish(reply({ placements: [], checks: [] })) })
  expect(drawerStart.disabled).toBe(false)
})

test('sidebar keeps Checkout named below the placement notice for this draft page', async () => {
  history.replaceState({}, '', '/admin/puck/pages/here')
  const placements = [{ collection: 'pages', id: 'here', title: 'Landing', detail: 'Draft' }, { collection: 'pages', id: 'other', title: 'Checkout', detail: 'Draft' }]
  checks = [{ code: 'placement-unpublished', ok: false, detail: placements }]
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight') ? Promise.resolve(reply({ placements, checks })) : original(url, init))
  await mount()
  expect(fields().getByText('Publish this page to start the test.')).toBeTruthy()
  expect(fields().getByText("The block you're testing is only on a draft of Checkout. Publish the page before you start.", { exact: false })).toBeTruthy()
  expect(fields().queryByRole('button', { name: 'Start' })).toBeNull()
  history.replaceState({}, '', '/')
})

test.each([false, true])('unpublished refusal clears permanently through publish and a ready answer (drawer: %s)', async drawer => {
  if (drawer) render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  else await mount()
  const scope = drawer ? within(await screen.findByRole('dialog')) : fields()
  const start = await scope.findByRole('button', { name: 'Start' })
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).endsWith('/start')) {
      checks = [{ code: 'placement-unpublished', ok: false, detail: [{ title: 'Landing' }] }]
      return Promise.resolve(reply({ errors: [{ code: 'placement-unpublished', detail: [{ title: 'Landing' }] }] }, 422))
    }
    return original(url, init)
  })
  fireEvent.click(start)
  await scope.findAllByText("The block you're testing is only on a draft of Landing. Publish the page before you start.", { exact: false })
  await waitFor(() => expect(scope.queryByRole('alert')).toBeNull())
  checks = [] // The person publishes; the next server answer is ready.
  const { refreshPlacements } = await import('../../../src/puck/editor/placementsCache.js')
  await act(async () => { await refreshPlacements('/api', doc.id) })
  expect(scope.queryByRole('alert')).toBeNull()
  expect(scope.getByText('Ready to start.')).toBeTruthy()
  expect((scope.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(false)
})

test('visible name inputs save on blur and Enter, Escape restores, errors stay next to the name', async () => {
  await mount()
  const group = () => within(fields().getByRole('group', { name: doc.arms[1]!.label }))
  let name = group().getByRole<HTMLInputElement>('textbox')
  const feedback = group().getByText(C.saved)
  expect(feedback.getAttribute('aria-hidden')).toBe('true')
  changeField(name, { target: { value: 'Cancelled' } }); fireEvent.keyDown(name, { key: 'Escape' }); fireEvent.blur(name)
  expect(name.value).toBe('Variant A')
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  changeField(name, { target: { value: 'Shorter' } }); fireEvent.blur(name)
  await screen.findByRole('tab', { name: 'Shorter' })
  expect(await group().findByRole('status')).toBe(feedback)
  expect(feedback.getAttribute('aria-hidden')).toBe('false')
  expect(name.getAttribute('aria-describedby')).toBe(feedback.id)
  await waitFor(() => expect(group().getByRole<HTMLInputElement>('textbox').disabled).toBe(false))
  name = group().getByRole<HTMLInputElement>('textbox')
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' ? Promise.resolve(reply({ errors: [{ code: 'forbidden' }] }, 403)) : original(url, init))
  changeField(name, { target: { value: 'Refused' } }); fireEvent.keyDown(name, { key: 'Enter' }); fireEvent.blur(name)
  expect((await group().findByRole('alert')).textContent).toBe("You don't have permission to do this.")
  expect(name.getAttribute('aria-describedby')).toBe(group().getByRole('alert').id)
  expect(name.getAttribute('aria-errormessage')).toBe(group().getByRole('alert').id)
  expect(screen.queryByRole('tab', { name: 'Refused' })).toBeNull()
})

test('version group headers and canvas tabs stay in step without changing real Puck selection', async () => {
  const actions = await mount()
  const original = fields().getByRole('group', { name: 'Original' })
  const variant = fields().getByRole('group', { name: 'Variant A' })
  const originalOpen = within(original).getByRole('button', { name: 'Show Original on the page' })
  const variantOpen = within(variant).getByRole('button', { name: 'Show Variant A on the page' })
  expect(originalOpen.getAttribute('aria-pressed')).toBe('true')
  expect(variantOpen.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(variantOpen)
  expect(variantOpen.getAttribute('aria-pressed')).toBe('true')
  expect(originalOpen.getAttribute('aria-pressed')).toBe('false')
  expect(variant.getAttribute('aria-current')).toBe('true')
  expect(screen.getByRole('tab', { name: 'Variant A' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByRole('tab', { name: 'Original' }))
  expect(original.getAttribute('data-active')).toBe('true')
  expect(variant.getAttribute('data-active')).toBe('false')
  expect(originalOpen.getAttribute('aria-pressed')).toBe('true')
  expect(variantOpen.getAttribute('aria-pressed')).toBe('false')
  expect(variant.getAttribute('aria-current')).toBeNull()
  fireEvent.click(variant)
  expect(variantOpen.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('tab', { name: 'Variant A' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(fields().getByRole('button', { name: 'More' }))
  fireEvent.click(fields().getByRole('button', { name: 'Use a different test' }))
  const chooser = await screen.findByRole('dialog')
  openSelect(await within(chooser).findByRole('combobox'))
  expect(within(chooser).queryByRole('option', { name: 'No test' })).toBeNull()
  expect(within(chooser).getByRole('button', { name: 'Create a test' })).toBeTruthy()
  expect(actions).toEqual([])
})

test('a later operation failure does not become a successful name field’s error', async () => {
  await mount()
  const name = fields().getByRole('textbox', { name: 'Variant A Name' })
  changeField(name, { target: { value: 'Short ask' } }); fireEvent.blur(name)
  await screen.findByRole('tab', { name: 'Short ask' })
  const group = within(fields().getByRole('group', { name: 'Short ask' }))
  expect(await group.findByText('Saved')).toBeTruthy()
  await waitFor(() => expect((fields().getByRole('button', { name: C.add }) as HTMLButtonElement).disabled).toBe(false))
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  fireEvent.click(fields().getByRole('button', { name: C.add }))
  await fields().findByRole('alert')
  expect(group.queryByRole('alert')).toBeNull()
  expect(group.getByRole('textbox').getAttribute('aria-invalid')).toBeNull()
})

test('leftover headers and tabs show the same active version and defer switches while dragging', async () => {
  const actions = await mount(false, true)
  const button = fields().getByRole('button', { name: 'Show Variant C on the page' })
  const card = button.closest('.xp-slot-version-group')!
  expect(card.querySelector('[class*=FieldGroup]')).toBeNull()
  expect(within(card as HTMLElement).getByText(C.outsideTest('Variant C'))).toBeTruthy()
  expect(fields().getByRole('button', { name: C.addLeftover }).parentElement).toBe(fields().getByRole('button', { name: C.deleteContent }).parentElement)
  fireEvent.click(button)
  expect(screen.getByRole('tab', { name: C.outsideTest('Variant C') }).getAttribute('aria-selected')).toBe('true')
  expect(button.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('tab', { name: 'Original' }))
  expect(button.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(card)
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(card.getAttribute('aria-current')).toBe('true')
  act(() => read().dispatch({ type: 'setUi', ui: { isDragging: true } }))
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(actions).toEqual([])
})

test('saved names, including Control, agree in tabs, sidebar, traffic and content guidance', async () => {
  doc.arms[0]!.label = 'Control'; doc.arms[1]!.label = 'Short ask'
  await mount()
  const header = chrome()
  expect(header.getByText('This block shows the Control to everyone until the test starts.')).toBeTruthy()
  expect(screen.getByRole('tab', { name: 'Control' })).toBeTruthy()
  expect(fields().getByRole('group', { name: 'Control' })).toBeTruthy()
  expect((fields().getByRole('textbox', { name: 'Control Name' }) as HTMLInputElement).value).toBe('Control')
  expect(fields().getByRole('spinbutton', { name: 'Control traffic (%)' })).toBeTruthy()
  expect(fields().getByRole('button', { name: 'Copy Control here' })).toBeTruthy()
  expect(screen.getByText('Drop Control content here')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Short ask' }))
  expect(screen.getByText('Drop Short ask content here')).toBeTruthy()
  expect(header.queryByText(/Original/)).toBeNull()
})

test.each([403, 404])('a manager can replace an unavailable binding (%s) through More', async code => {
  testCode = code
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => String(url).includes('/xp-experiments?') ? Promise.resolve(reply({ docs: [{ ...doc, id: 'replacement', slug: 'replacement' }] }))
    : String(url).includes('/xp-experiments/replacement?') ? Promise.resolve(reply(doc)) : original(url, init))
  await mount()
  fireEvent.click(fields().getByRole('button', { name: 'More' }))
  fireEvent.click(fields().getByRole('button', { name: 'Use a different test' }))
  const dialog = await screen.findByRole('dialog')
  const picker = await within(dialog).findByRole('combobox')
  expect((within(dialog).getByRole('button', { name: 'Create a test' }) as HTMLButtonElement).disabled).toBe(false)
  changeField(picker, { target: { value: 'replacement' } })
  await waitFor(() => expect(read().getItemById('sidebar-block')?.props.experiment).toEqual({ id: 'replacement', slug: 'replacement' }))
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
})

test('a results reader with a readable test gets read-only version fields and one rights explanation', async () => {
  role = 'results'
  await mount()
  const versions = await fields().findByRole('region', { name: 'Versions' })
  for (const input of within(versions).getAllByRole('textbox')) expect((input as HTMLInputElement).readOnly).toBe(true)
  for (const input of within(versions).getAllByRole('spinbutton')) expect((input as HTMLInputElement).readOnly).toBe(true)
  expect(within(versions).getAllByText(C.readOnlyVersions)).toHaveLength(1)
  for (const name of [C.add, C.split, C.removeVersion, C.moreGroup]) expect(fields().queryByRole('button', { name })).toBeNull()
  expect(fields().getByRole('button', { name: C.configure })).toBeTruthy()
})


test.each([403, 404, 500, 0, 'malformed'] as const)('unreadable binding %s has the right header, sidebar and recovery actions', async code => {
  testCode = typeof code === 'number' ? code || 500 : 200
  if (code === 'malformed') {
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((url, init) => String(url).includes('/sidebar-test?') ? Promise.resolve(reply({ ...doc, arms: [null] })) : original(url, init))
  }
  if (!code) {
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((url, init) => String(url).includes('/sidebar-test?') ? Promise.reject(new Error('offline')) : original(url, init))
  }
  await mount(false, false, code === 'malformed')
  if (code === 404) {
    expect(chrome().getByRole('heading', { name: C.deleted })).toBeTruthy()
    expect(fields().getByText(C.deleted)).toBeTruthy()
    expect(chrome().getByRole('button', { name: C.createLabel })).toBeTruthy()
    expect(fields().getByRole('button', { name: C.createLabel })).toBeTruthy()
  } else {
    expect(chrome().queryByRole('button', { name: C.createLabel })).toBeNull()
    expect(fields().queryByRole('button', { name: C.createLabel })).toBeNull()
  }
  if (code === 403 || code === 404) {
    if (code === 403) {
      expect(chrome().getByText("You don't have access to this test. You can still edit its content.")).toBeTruthy()
      expect(fields().getByText("You don't have access to this test. You can still edit its content.")).toBeTruthy()
    }
    fireEvent.click(fields().getByRole('button', { name: C.moreGroup }))
    fireEvent.click(fields().getByRole('button', { name: C.differentTest }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByRole('button', { name: C.createAnother }) as HTMLButtonElement).disabled).toBe(false)
    const reads = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/sidebar-test?')).length
    fireEvent.click(within(dialog).getByRole('button', { name: C.createAnother }))
    const create = await screen.findByRole('dialog')
    await within(create).findByRole('textbox', { name: /Name/ })
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/sidebar-test?'))).toHaveLength(reads)
  } else {
    expect(chrome().getByRole('button', { name: C.retrySetup })).toBeTruthy()
    expect(fields().getByRole('button', { name: C.retrySetup })).toBeTruthy()
    expect(fields().queryByRole('button', { name: C.configure })).toBeNull()
    fireEvent.click(fields().getByRole('button', { name: C.moreGroup }))
    fireEvent.click(fields().getByRole('button', { name: C.differentTest }))
    const dialog = await screen.findByRole('dialog')
    const reads = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/sidebar-test?')).length
    fireEvent.click(within(dialog).getByRole('button', { name: C.createAnother }))
    await within(await screen.findByRole('dialog')).findByRole('textbox', { name: /Name/ })
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/sidebar-test?'))).toHaveLength(reads)
  }
})


test('Traffic keeps focus while saving and the next Name control stays in the sidebar tab order', async () => {
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: () => void
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH'
    ? new Promise(resolve => { finish = () => { void original(url, init).then(resolve) } }) : original(url, init))
  const input = fields().getByRole<HTMLInputElement>('spinbutton', { name: C.weight('Original') })
  input.focus()
  changeField(input, { target: { value: '60' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(document.activeElement).toBe(input)
  expect(input.disabled).toBe(false)
  expect(input.readOnly).toBe(true)
  const name = fields().getByRole<HTMLInputElement>('textbox', { name: 'Variant A Name' })
  expect(name.disabled).toBe(false)
  // jsdom has no Tab default action. Follow its focusable target after delivering Tab.
  fireEvent.keyDown(input, { key: 'Tab' }); name.focus()
  expect(screen.getByTestId('sidebar').contains(document.activeElement)).toBe(true)
  await act(async () => finish())
  await waitFor(() => expect(input.readOnly).toBe(false))
  expect(document.activeElement).toBe(name)
})

test('a Name commit made during a Traffic save queues and preserves both intents', async () => {
  await mount()
  const name = fields().getByRole<HTMLInputElement>('textbox', { name: 'Variant A Name' })
  changeField(name, { target: { value: 'Queued name' } })
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: () => void
  let patches = 0
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' && ++patches === 1
    ? new Promise(resolve => { finish = () => { void original(url, init).then(resolve) } }) : original(url, init))
  const input = fields().getByLabelText(C.weight('Original'))
  changeField(input, { target: { value: '60' } }); fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  fireEvent.blur(name)
  expect(patches).toBe(1)
  await act(async () => finish())
  await screen.findByRole('tab', { name: 'Queued name' })
  expect(doc.arms.map(arm => [arm.label, arm.weight])).toEqual([['Original', 60], ['Queued name', 40]])
  expect(patches).toBe(2)
})

test.each(['draft', 'running', 'stopped', 'decided', 'archived'] as const)('leftover content actions respect %s status and reader rights', async status => {
  doc.status = status
  await mount(false, true)
  expect(Boolean(fields().queryByRole('button', { name: C.addLeftover }))).toBe(status === 'draft')
  expect(fields().getByRole('button', { name: C.deleteContent })).toBeTruthy()
  cleanup(); role = 'results'
  await mount(false, true)
  expect(fields().queryByRole('button', { name: C.addLeftover })).toBeNull()
  fireEvent.click(fields().getByRole('button', { name: C.deleteContent }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: C.deleteContent }))
  await waitFor(() => expect(read().getItemById('sidebar-block')?.props.variantC).toEqual([]))
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  cleanup(); role = 'none'
  await mount(false, true)
  expect(fields().queryByRole('button', { name: C.addLeftover })).toBeNull()
  expect(fields().queryByRole('button', { name: C.deleteContent })).toBeNull()
})

test.each([false, true])('creating through Use a different test preserves gapped page content and excludes holdout (refused: %s)', async refused => {
  doc.arms = [doc.arms[0]!, { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 }, { ...doc.arms[1]!, key: 'variantB', slot: 'variantB', label: 'Saved B', weight: 40 }]
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'POST'
    ? Promise.resolve(reply(refused ? {} : { doc: { id: 'created', slug: 'new-test' } }, refused ? 403 : 200)) : original(url, init))
  await mount(false, true)
  const before = structuredClone(read().getItemById('sidebar-block'))
  fireEvent.click(fields().getByRole('button', { name: C.moreGroup }))
  fireEvent.click(fields().getByRole('button', { name: C.differentTest }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: C.createAnother }))
  const dialog = await screen.findByRole('dialog')
  changeField(within(dialog).getByRole('textbox', { name: C.name }), { target: { value: 'Replacement' } })
  fireEvent.click(within(dialog).getByRole('button', { name: C.createAnother }))
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
  const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(String(post[1]!.body)).arms.map((arm: { key: string; label: string }) => [arm.key, arm.label])).toEqual([['control', 'Original'], ['variantB', 'Saved B'], ['variantC', 'Variant C']])
  if (refused) {
    await within(dialog).findByRole('alert')
    expect(read().getItemById('sidebar-block')).toEqual(before)
  } else {
    await waitFor(() => expect(read().getItemById('sidebar-block')?.props.experiment?.id).toBe('created'))
    expect(read().getItemById('sidebar-block')?.props.variantC).toEqual(before?.props.variantC)
  }
})


test.each([403, 404])('Create a test from an unavailable binding %s uses page content without reading the old test', async code => {
  testCode = code
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'POST'
    ? Promise.resolve(reply({ doc: { id: 'created', slug: 'replacement' } })) : original(url, init))
  await mount(false, true)
  const reads = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/sidebar-test?')).length
  fireEvent.click(fields().getByRole('button', { name: C.moreGroup }))
  fireEvent.click(fields().getByRole('button', { name: C.differentTest }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: C.createAnother }))
  const dialog = await screen.findByRole('dialog')
  changeField(within(dialog).getByRole('textbox', { name: C.name }), { target: { value: 'Replacement' } })
  fireEvent.click(within(dialog).getByRole('button', { name: C.createAnother }))
  await waitFor(() => expect(read().getItemById('sidebar-block')?.props.experiment?.id).toBe('created'))
  const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(String(post[1]!.body)).arms.map((arm: { key: string }) => arm.key)).toEqual(['control', 'variantC'])
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/sidebar-test?'))).toHaveLength(reads)
})


test('a refused Traffic save retains its draft and error after the queued Name succeeds', async () => {
  await mount()
  const name = fields().getByRole<HTMLInputElement>('textbox', { name: 'Variant A Name' })
  changeField(name, { target: { value: 'Queued name' } })
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: () => void
  let patches = 0
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' && ++patches === 1
    ? new Promise(resolve => { finish = () => resolve(reply({}, 403)) }) : original(url, init))
  const input = fields().getByRole<HTMLInputElement>('spinbutton', { name: C.weight('Original') })
  changeField(input, { target: { value: '60' } }); fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  fireEvent.blur(name)
  await act(async () => finish())
  await screen.findByRole('tab', { name: 'Queued name' })
  expect(fields().getByRole('alert').textContent).toBe("You don't have permission to do this.")
  expect(input.value).toBe('60')
  expect(doc.arms.map(arm => arm.weight)).toEqual([50, 50])
  expect(patches).toBe(2)
  changeField(input, { target: { value: '70' } })
  expect(fields().queryByRole('alert')).toBeNull()
})

test.each([false, true])('Escape cancels only a Name save that has not started (started: %s)', async started => {
  await mount()
  const name = fields().getByRole<HTMLInputElement>('textbox', { name: 'Variant A Name' })
  changeField(name, { target: { value: 'Escaped name' } })
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: () => void
  let patches = 0
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' && ++patches === 1
    ? new Promise(resolve => { finish = () => { void original(url, init).then(resolve) } }) : original(url, init))
  if (!started) {
    const input = fields().getByLabelText(C.weight('Original'))
    changeField(input, { target: { value: '60' } }); fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(finish).toBeTypeOf('function'))
  }
  fireEvent.keyDown(name, { key: 'Enter' })
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  fireEvent.keyDown(name, { key: 'Escape' })
  expect(name.value).toBe(started ? 'Escaped name' : 'Variant A')
  await act(async () => finish())
  await waitFor(() => expect(name.readOnly).toBe(false))
  expect(doc.arms[1]!.label).toBe(started ? 'Escaped name' : 'Variant A')
  expect(patches).toBe(1)
})


test('a refused Split never replaces another Traffic control’s refusal', async () => {
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  const input = fields().getByLabelText(C.weight('Original'))
  changeField(input, { target: { value: '60' } }); fireEvent.keyDown(input, { key: 'Enter' })
  await fields().findByRole('alert')
  await waitFor(() => expect((input as HTMLInputElement).readOnly).toBe(false))
  fireEvent.click(fields().getByRole('button', { name: C.split }))
  await waitFor(() => expect(fields().getAllByRole('alert')).toHaveLength(2))
  expect(within(fields().getByRole('group', { name: 'Original' })).getByRole('alert').textContent).toBe("You don't have permission to do this.")
})

test('saving and escaping another Traffic control preserve the first refused draft', async () => {
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  let refuse = true
  vi.mocked(fetch).mockImplementation((url, init) => refuse && init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  const control = fields().getByRole<HTMLInputElement>('spinbutton', { name: C.weight('Original') })
  const variant = fields().getByRole<HTMLInputElement>('spinbutton', { name: C.weight('Variant A') })
  changeField(control, { target: { value: '60' } }); fireEvent.keyDown(control, { key: 'Enter' })
  await fields().findByRole('alert')
  await waitFor(() => expect(control.readOnly).toBe(false))
  refuse = false
  changeField(variant, { target: { value: '45' } }); fireEvent.keyDown(variant, { key: 'Enter' })
  await waitFor(() => expect(doc.arms.map(arm => arm.weight)).toEqual([55, 45]))
  expect(control.value).toBe('60')
  expect(variant.value).toBe('45')
  expect(fields().getByRole('alert').textContent).toBe("You don't have permission to do this.")
  await waitFor(() => expect(variant.readOnly).toBe(false))
  changeField(variant, { target: { value: '40' } }); fireEvent.keyDown(variant, { key: 'Escape' })
  expect(control.value).toBe('60')
  expect(fields().getByRole('alert')).toBeTruthy()
})

test('removing a version clears its Traffic draft without retaining a missing control as unsaved', async () => {
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  let refuse = true
  vi.mocked(fetch).mockImplementation((url, init) => refuse && init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  const variant = fields().getByRole<HTMLInputElement>('spinbutton', { name: C.weight('Variant A') })
  changeField(variant, { target: { value: '40' } }); fireEvent.keyDown(variant, { key: 'Enter' })
  await fields().findByRole('alert')
  await waitFor(() => expect(variant.readOnly).toBe(false))
  refuse = false
  fireEvent.click(fields().getByRole('button', { name: C.removeVersion }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: C.remove }))
  await waitFor(() => expect(fields().queryByRole('spinbutton', { name: C.weight('Variant A') })).toBeNull())
  expect(await fields().findByRole('button', { name: 'Start' })).toBeTruthy()
  expect(fields().queryByRole('alert')).toBeNull()
})


test('a Traffic completion cannot restore a draft pruned by an in-flight external version removal', async () => {
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  const control = fields().getByRole<HTMLInputElement>('spinbutton', { name: C.weight('Original') })
  const variant = fields().getByRole<HTMLInputElement>('spinbutton', { name: C.weight('Variant A') })
  changeField(variant, { target: { value: '40' } })
  // The balanced preview is already 60; use a distinct value to create a second draft.
  changeField(control, { target: { value: '70' } })
  let finish!: () => void
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH'
    ? new Promise(resolve => { finish = () => resolve(reply({ doc })) }) : original(url, init))
  fireEvent.keyDown(control, { key: 'Enter' })
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  doc = { ...doc, arms: [{ ...doc.arms[0]!, weight: 100 }], updatedAt: 'two' }
  act(() => publishExperiment(doc.id, doc))
  await waitFor(() => expect(fields().queryByRole('spinbutton', { name: C.weight('Variant A') })).toBeNull())
  await act(async () => finish())
  expect(await fields().findByRole('button', { name: 'Start' })).toBeTruthy()
  expect(control.value).toBe('100')
})

test('a refused Remove appears once and clears on Cancel before reopening or adding a version', async () => {
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  let refuse = true
  vi.mocked(fetch).mockImplementation((url, init) => refuse && init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  fireEvent.click(fields().getByRole('button', { name: C.removeVersion }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: C.remove }))
  const alert = await within(dialog).findByRole('alert')
  expect(screen.getAllByRole('alert')).toEqual([alert])
  await waitFor(() => expect(within(dialog).getByRole('button', { name: C.cancel }).getAttribute('aria-disabled')).toBeNull())
  fireEvent.click(within(dialog).getByRole('button', { name: C.cancel }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(fields().queryByRole('alert')).toBeNull()
  fireEvent.click(fields().getByRole('button', { name: C.removeVersion }))
  const reopened = await screen.findByRole('dialog')
  expect(within(reopened).queryByRole('alert')).toBeNull()
  fireEvent.click(within(reopened).getByRole('button', { name: C.cancel }))
  refuse = false
  fireEvent.click(fields().getByRole('button', { name: C.add }))
  await fields().findByRole('group', { name: 'Variant B' })
  expect(fields().queryByRole('alert')).toBeNull()
})

test('Use a different test clears a prior write refusal from the old binding', async () => {
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  fireEvent.click(fields().getByRole('button', { name: C.add }))
  await fields().findByRole('alert')
  const replacement = { ...doc, id: 'replacement-test', name: 'Replacement', slug: 'replacement' }
  vi.mocked(fetch).mockImplementation((url, init) => String(url).includes('/xp-experiments?') ? Promise.resolve(reply({ docs: [doc, replacement] }))
    : String(url).includes('/xp-experiments/replacement-test?') ? Promise.resolve(reply(replacement)) : original(url, init))
  fireEvent.click(fields().getByRole('button', { name: C.moreGroup }))
  fireEvent.click(fields().getByRole('button', { name: C.differentTest }))
  const dialog = await screen.findByRole('dialog')
  openSelect(await within(dialog).findByRole('combobox'))
  await within(dialog).findByRole('option', { name: /Replacement/ })
  changeField(within(dialog).getByRole('combobox'), { target: { value: 'replacement-test' } })
  await waitFor(() => expect(read().getItemById('sidebar-block')?.props.experiment?.id).toBe('replacement-test'))
  await fields().findByText('Replacement')
  expect(fields().queryByRole('alert')).toBeNull()
})

test.each(['remove', 'leftover'] as const)('a %s refusal stays only while its control or dialog remains', async kind => {
  await mount(false, true)
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  if (kind === 'remove') {
    fireEvent.click(fields().getByRole('button', { name: C.removeVersion }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: C.remove }))
    await within(screen.getByRole('dialog')).findByRole('alert')
    doc = { ...doc, arms: [doc.arms[0]!], updatedAt: 'two' }
    act(() => publishExperiment(doc.id, doc))
  } else {
    fireEvent.click(fields().getByRole('button', { name: C.addLeftover }))
    await fields().findByRole('alert')
    const item = read().getItemById('sidebar-block')!
    const selector = read().getSelectorForId(item.props.id)!
    act(() => read().dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone, data: { ...item, props: { ...item.props, variantC: [] } } }))
  }
  if (kind === 'remove') {
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('alert').textContent).toBe("You don't have permission to do this.")
    fireEvent.click(within(dialog).getByRole('button', { name: C.cancel }))
  }
  await waitFor(() => expect(fields().queryByRole('alert')).toBeNull())
})

test('a successful Split clears every Traffic refusal and restores Start', async () => {
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  for (const label of ['Original', 'Variant A']) {
    const input = fields().getByRole<HTMLInputElement>('spinbutton', { name: C.weight(label) })
    changeField(input, { target: { value: '60' } }); fireEvent.keyDown(input, { key: 'Enter' })
    await within(fields().getByRole('group', { name: label })).findByRole('alert')
    await waitFor(() => expect(input.readOnly).toBe(false))
  }
  vi.mocked(fetch).mockImplementation(original)
  fireEvent.click(fields().getByRole('button', { name: C.split }))
  await waitFor(() => expect(fields().getByRole<HTMLInputElement>('spinbutton', { name: C.weight('Original') }).value).toBe('50'))
  expect(fields().queryByRole('alert')).toBeNull()
  expect(await fields().findByRole('button', { name: 'Start' })).toBeTruthy()
})

test.each(['remove', 'leftover'] as const)('an in-flight %s refusal stays with an open dialog and is discarded for a disappeared control', async kind => {
  await mount(false, true)
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: () => void
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH'
    ? new Promise(resolve => { finish = () => resolve(reply({}, 403)) }) : original(url, init))
  if (kind === 'remove') {
    fireEvent.click(fields().getByRole('button', { name: C.removeVersion }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: C.remove }))
  } else fireEvent.click(fields().getByRole('button', { name: C.addLeftover }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  if (kind === 'remove') {
    doc = { ...doc, arms: [doc.arms[0]!], updatedAt: 'two' }
    act(() => publishExperiment(doc.id, doc))
    await waitFor(() => expect(fields().queryByRole('spinbutton', { name: C.weight('Variant A') })).toBeNull())
  } else {
    const item = read().getItemById('sidebar-block')!
    const selector = read().getSelectorForId(item.props.id)!
    act(() => read().dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone, data: { ...item, props: { ...item.props, variantC: [] } } }))
    await waitFor(() => expect(fields().queryByRole('button', { name: C.addLeftover })).toBeNull())
  }
  await act(async () => finish())
  await waitFor(() => expect(screen.queryByText(C.savingVersions)).toBeNull())
  if (kind === 'remove') {
    const dialog = screen.getByRole('dialog')
    const alert = within(dialog).getByRole('alert')
    expect(alert.textContent).toBe("You don't have permission to do this.")
    expect(screen.getAllByRole('alert')).toEqual([alert])
  } else {
    expect(fields().queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  }
})

test('a successful Add version clears an unrelated Split refusal in the version controls', async () => {
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  fireEvent.click(fields().getByRole('button', { name: C.split }))
  await fields().findByRole('alert')
  await waitFor(() => expect(fields().getByRole('button', { name: C.add }).getAttribute('aria-disabled')).toBeNull())
  vi.mocked(fetch).mockImplementation(original)
  fireEvent.click(fields().getByRole('button', { name: C.add }))
  await fields().findByRole('group', { name: 'Variant B' })
  expect(fields().queryByRole('alert')).toBeNull()
})


test('an open Remove dialog shows the locked refusal after the test starts elsewhere', async () => {
  await mount()
  fireEvent.click(fields().getByRole('button', { name: C.removeVersion }))
  const dialog = await screen.findByRole('dialog')
  doc = { ...doc, status: 'running', updatedAt: 'two' }
  act(() => publishExperiment(doc.id, doc))
  await waitFor(() => expect(fields().queryByRole('button', { name: C.removeVersion })).toBeNull())
  fireEvent.click(within(dialog).getByRole('button', { name: C.remove }))
  const alert = await within(dialog).findByRole('alert')
  expect(alert.textContent).toBe(C.locked.running)
  expect(screen.getAllByRole('alert')).toEqual([alert])
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
})

test.each(['split', 'add'] as const)('a pending %s shows the locked refusal after the test starts elsewhere', async control => {
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: () => void
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/xp-experiments/sidebar-test?depth=0')
    ? new Promise(resolve => { finish = () => resolve(reply(doc)) }) : original(url, init))
  fireEvent.click(fields().getByRole('button', { name: control === 'split' ? C.split : C.add }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  doc = { ...doc, status: 'running', updatedAt: 'two' }
  act(() => publishExperiment(doc.id, doc))
  await waitFor(() => expect(fields().queryByRole('button', { name: C.add })).toBeNull())
  await act(async () => finish())
  expect((await fields().findByRole('alert')).textContent).toBe(C.locked.running)
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
})

test.each(['split', 'add'] as const)('a %s lock refusal survives same-status reads and clears on a later status change', async control => {
  await mount()
  doc = { ...doc, status: 'running', updatedAt: 'two' }
  // This fresh read publishes running and raises the refusal in the same batch.
  fireEvent.click(fields().getByRole('button', { name: control === 'split' ? C.split : C.add }))
  expect((await fields().findByRole('alert')).textContent).toBe(C.locked.running)
  doc = { ...doc, name: 'Updated name', updatedAt: 'three' }
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  await fields().findByText('Updated name')
  expect(fields().getByRole('alert').textContent).toBe(C.locked.running)
  doc = { ...doc, status: 'stopped', updatedAt: 'four' }
  act(() => publishExperiment(doc.id, doc))
  await fields().findByRole('button', { name: C.add })
  await waitFor(() => expect(fields().queryByRole('alert')).toBeNull())
  // A later return to the recorded status cannot resurrect the refusal.
  doc = { ...doc, status: 'running', updatedAt: 'five' }
  act(() => publishExperiment(doc.id, doc))
  await waitFor(() => expect(fields().queryByRole('button', { name: C.add })).toBeNull())
  expect(fields().queryByRole('alert')).toBeNull()
})

test('an Add refusal clears when Add disappears at the version cap, even while locked', async () => {
  await mount()
  doc = { ...doc, status: 'running', updatedAt: 'two' }
  fireEvent.click(fields().getByRole('button', { name: C.add }))
  expect((await fields().findByRole('alert')).textContent).toBe(C.locked.running)
  doc = { ...doc, updatedAt: 'three', arms: [...doc.arms,
    { key: 'variantB', slot: 'variantB', kind: 'variant', label: 'Variant B', weight: 0 },
    { key: 'variantC', slot: 'variantC', kind: 'variant', label: 'Variant C', weight: 0 }] }
  act(() => publishExperiment(doc.id, doc))
  await fields().findByRole('group', { name: 'Variant C' })
  expect(fields().queryByRole('button', { name: C.add })).toBeNull()
  await waitFor(() => expect(fields().queryByRole('alert')).toBeNull())
  doc = { ...doc, arms: doc.arms.filter(arm => arm.key !== 'variantC'), updatedAt: 'four' }
  act(() => publishExperiment(doc.id, doc))
  await waitFor(() => expect(fields().queryByRole('group', { name: 'Variant C' })).toBeNull())
  expect(fields().queryByRole('alert')).toBeNull()
})

test.each(['Split', 'Traffic', 'Name'] as const)('%s refuses an older read with stale-edit and retries against the accepted stopped document', async control => {
  doc.updatedAt = '2026-11-18T20:00:00.000Z'
  await mount()
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: () => void
  const older = { ...doc, status: 'running', updatedAt: '2026-11-18T20:01:00.000Z' }
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/xp-experiments/sidebar-test?depth=0')
    ? new Promise(resolve => { finish = () => resolve(reply(older)) }) : original(url, init))
  const attempt = () => {
    if (control === 'Split') fireEvent.click(fields().getByRole('button', { name: C.split }))
    else {
      const input = control === 'Traffic' ? fields().getByLabelText(C.weight('Original')) : fields().getByRole('textbox', { name: 'Variant A Name' })
      changeField(input, { target: { value: control === 'Traffic' ? '60' : 'New headline' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    }
  }
  attempt()
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  doc = { ...doc, status: 'stopped', arms: doc.arms.map((arm, i) => ({ ...arm, weight: i ? 30 : 70 })), updatedAt: '2026-11-18T20:02:00.000Z' }
  act(() => publishExperiment(doc.id, doc))
  await fields().findByText('Stopped')
  await act(async () => finish())
  const group = control === 'Split' ? fields() : within(fields().getByRole('group', { name: control === 'Traffic' ? 'Original' : 'Variant A' }))
  expect((await group.findByRole('alert')).textContent).toBe(C.staleEdit)
  expect(fields().queryByText(C.locked.running)).toBeNull()
  expect(await fields().findByRole('button', { name: 'Start a new round' })).toBeTruthy()
  expect((fields().getByLabelText(C.weight('Original')) as HTMLInputElement).readOnly).toBe(false)
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  expect(doc.arms.map(arm => arm.weight)).toEqual([70, 30])

  vi.mocked(fetch).mockImplementation(original)
  attempt()
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1))
  await waitFor(() => expect(fields().queryByRole('alert')).toBeNull())
  const patch = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH')![1]!
  expect(new Headers(patch.headers).get('x-xp-if-updated-at')).toBe('2026-11-18T20:02:00.000Z')
  if (control === 'Name') expect(doc.arms[1]!.label).toBe('New headline')
  else expect(doc.arms.map(arm => arm.weight)).toEqual(control === 'Split' ? [50, 50] : [60, 40])
})

test('the first render under a new binding excludes the previous binding’s refusal', async () => {
  const renders: Array<{ bindingKey: string; error: string; splitError?: string }> = []
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  const { result, rerender } = renderHook(({ bindingKey }) => {
    const writes = useArmWrites({ url: '/api/xp-experiments/sidebar-test', bindingKey, controlKeys: ['split', 'add'],
      publish: () => {}, isCurrent: () => true, onWrite: () => {} })
    renders.push({ bindingKey, error: writes.error, splitError: writes.errorFor('split') })
    return writes
  }, { initialProps: { bindingKey: 'first' } })
  await act(async () => { await result.current.write(arms => arms, { errorKey: 'split' }) })
  expect(result.current.error).toBe("You don't have permission to do this.")
  rerender({ bindingKey: 'second' })
  expect(renders.find(render => render.bindingKey === 'second')).toEqual({ bindingKey: 'second', error: '', splitError: undefined })
})


test('Tab and field interaction never open another version', async () => {
  await mount()
  const originalTab = screen.getByRole('tab', { name: 'Original' })
  const region = fields().getByRole('region', { name: C.versionsGroup })
  const controls = region.querySelectorAll<HTMLElement>('button, input')
  for (const control of controls) {
    fireEvent.keyDown(document.activeElement ?? region, { key: 'Tab' })
    act(() => control.focus()) // jsdom has no native Tab focus traversal.
    expect(originalTab.getAttribute('aria-selected')).toBe('true')
  }
  const name = fields().getByRole('textbox', { name: 'Variant A Name' })
  fireEvent.click(name)
  fireEvent.change(name, { target: { value: 'Edited' } })
  fireEvent.keyDown(name, { key: 'Escape' })
  fireEvent.click(fields().getByRole('spinbutton', { name: C.weight('Variant A') }))
  expect(originalTab.getAttribute('aria-selected')).toBe('true')
})

test('Traffic errors identify their input and share the full-width feedback row', async () => {
  await mount()
  const input = fields().getByRole('spinbutton', { name: C.weight('Variant A') })
  const group = fields().getByRole('group', { name: 'Variant A' })
  fireEvent.change(input, { target: { value: '101' } })
  const error = within(group).getByRole('alert')
  expect(error.textContent).toBe(C.invalidShare)
  expect(input.getAttribute('aria-describedby')).toContain(error.id)
  expect(input.getAttribute('aria-errormessage')).toBe(error.id)
  expect(error.closest('.xp-slot-version-row')).toBe(input.closest('.xp-slot-version-row'))
  fireEvent.keyDown(input, { key: 'Escape' })
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH' ? Promise.resolve(reply({}, 403)) : original(url, init))
  fireEvent.change(input, { target: { value: '60' } }); fireEvent.blur(input)
  const refusal = await within(group).findByRole('alert')
  expect(input.getAttribute('aria-errormessage')).toBe(refusal.id)
  expect(refusal.textContent).toBe("You don't have permission to do this.")
})

test('locked holdout cards have no empty actions row', async () => {
  doc.status = 'running'
  doc.arms.push({ key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 } as typeof doc.arms[number])
  await mount()
  expect(fields().getByRole('group', { name: 'Holdout' }).querySelector('.xp-slot-version-actions')).toBeNull()
})

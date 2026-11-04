// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { defaultArms } from '../../../src/arms/model.js'
import { useArms } from '../../../src/puck/editor/armsCache.js'
import { editorCopy as C } from '../../../src/puck/editor/copy.js'
import type { Arm, Status } from '../../../src/types/contracts.js'

const puck = vi.hoisted(() => ({ dispatch: vi.fn(), item: { type: 'ExperimentSlot', props: {
  id: 'builder', control: [{ type: 'Text', props: { id: 'original' } }], variantA: [{ type: 'Text', props: { id: 'variant' } }], variantB: [], variantC: [],
} } }))
vi.mock('@puckeditor/core', async importOriginal => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  return { ...await importOriginal<typeof import('@puckeditor/core')>(),
    createUsePuck: () => (selector: (state: unknown) => unknown) => selector({ selectedItem: puck.item, getItemById: () => puck.item,
      appState: { data: { root: { props: {} } } } }),
    useGetPuck: () => () => ({ selectedItem: puck.item, getItemById: () => puck.item, dispatch: puck.dispatch,
      getSelectorForId: () => ({ index: 1, zone: 'root:default-zone' }) }),
  }
})
let doc: { name: string; status: Status; updatedAt: string; arms: Arm[] }
let refuse: { status: number; code: string } | undefined
let summary: unknown
let snapshot: unknown
let resultsStatus: number
let order: string[]
const Editor = createExperimentSlotEditor({ routes: { api: '/host-api', admin: '/manage' } }).render
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function CacheProbe() {
  const cached = useArms('builder-test')
  return <output aria-label="Cached versions">{cached?.arms.join(',')}</output>
}
function editor(id = 'builder-test') {
  return <><Editor id="builder" experiment={{ id, slug: 'example' }}
    control={() => <p>Original content</p>} variantA={() => <p>A content</p>} variantB={() => <p>B content</p>} variantC={() => <p>C content</p>}
    puck={{ renderDropZone: () => null, metadata: {}, isEditing: true, dragRef: null }} /><CacheProbe /></>
}
async function mount() {
  const view = render(editor())
  await screen.findByRole('tab', { name: 'Original' })
  await screen.findByRole('heading', { name: 'Example' })
  return view
}
function menu(label = 'Variant A') { fireEvent.click(screen.getByRole('button', { name: `Options for ${label}` })) }
function patches() { return vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH') }
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  doc = { name: 'Example', status: 'draft', updatedAt: '2026-11-03T20:00:00.000Z', arms: defaultArms('block') }
  refuse = undefined; resultsStatus = 200; order = []
  summary = { 'builder-test': { verdict: { headline: 'Variant A is ahead' } } }
  snapshot = { exposures: { perArm: { control: 1234, variantA: 1456 } } }
  puck.dispatch.mockReset()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/summary?')) { order.push('summary'); return response(summary, resultsStatus) }
    if (url.endsWith('/results')) { order.push('results'); return response({ snapshot }, resultsStatus) }
    if (init?.method === 'PATCH') {
      order.push('PATCH')
      if (refuse) return response({ errors: [{ code: refuse.code, message: 'SECRET SERVER TEXT' }] }, refuse.status)
      doc = { ...doc, ...JSON.parse(String(init.body)), updatedAt: '2026-11-03T20:01:00.000Z' }
      return response({ doc })
    }
    order.push('GET'); return response(doc)
  }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test.each(['draft', 'stopped'] as const)('%s adds A through C, selects the new tab, sends fresh arms/header, and updates the outline cache', async status => {
  doc.status = status
  doc.arms = [{ ...doc.arms[0]!, weight: 100 }]
  await mount()
  for (const [key, label] of [['variantA', 'Variant A'], ['variantB', 'Variant B'], ['variantC', 'Variant C']] as const) {
    const timestamp = `fresh-${key}`
    doc = { ...doc, updatedAt: timestamp, arms: doc.arms.map(arm => ({ ...arm, label: arm.key === 'control' ? 'Fresh Original' : arm.label })) }
    const previous = doc.arms
    const start = order.length
    const add = screen.getByRole('button', { name: C.add })
    fireEvent.click(add); fireEvent.click(add)
    const tab = await screen.findByRole('tab', { name: label })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(order.slice(start).filter(call => ['GET', 'PATCH'].includes(call))).toEqual(['GET', 'PATCH'])
    expect(patches().at(-1)).toEqual(['/host-api/xp-experiments/builder-test', expect.objectContaining({
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-xp-if-updated-at': timestamp },
      body: JSON.stringify({ arms: [...previous, { key, kind: 'variant', label, weight: 0, slot: key }] }),
    })])
    expect(screen.getByLabelText('Cached versions').textContent).toBe(doc.arms.map(arm => arm.key).join(','))
  }
  expect(screen.queryByRole('button', { name: C.add })).toBeNull()
  expect(patches()).toHaveLength(3)
})

test('Rename Enter saves once on fresh arms; Escape cancels and an empty name is refused locally', async () => {
  await mount(); menu()
  fireEvent.click(screen.getByRole('button', { name: C.rename }))
  let input = screen.getByLabelText(C.renameLabel)
  fireEvent.change(input, { target: { value: 'Cancelled' } }); fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByLabelText(C.renameLabel)).toBeNull(); expect(patches()).toHaveLength(0)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: C.menu('Variant A') }))
  menu(); fireEvent.click(screen.getByRole('button', { name: C.rename }))
  input = screen.getByLabelText(C.renameLabel)
  fireEvent.change(input, { target: { value: '   ' } }); fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByRole('alert').textContent).toBe(C.emptyLabel); expect(patches()).toHaveLength(0)
  doc.arms[0]!.label = 'Fresh Original'; doc.updatedAt = 'fresh-rename'
  fireEvent.change(input, { target: { value: 'Short headline' } }); fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByRole('tab', { name: 'Short headline' })
  expect(doc.arms[0]!.label).toBe('Fresh Original')
  expect(doc.arms[1]!.label).toBe('Short headline')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: C.menu('Short headline') })))
  expect(order).toEqual(['GET', 'GET', 'PATCH']); expect(patches()).toHaveLength(1)
})

test('Original can change label while keeping its control identity and has no Remove', async () => {
  await mount(); menu('Original')
  expect(screen.queryByRole('button', { name: C.remove })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: C.rename }))
  const input = screen.getByLabelText(C.renameLabel)
  fireEvent.change(input, { target: { value: 'Current appeal' } }); fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByRole('tab', { name: 'Current appeal' })
  expect(doc.arms[0]).toMatchObject({ key: 'control', kind: 'control', slot: 'control' })
})

test('Remove focuses Cancel; Escape closes; confirmation posts once, clears only that slot, and asks to save the page', async () => {
  const focus = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
    // Model native showModal's inert outside content; jsdom's dialog shim does not.
    const modal = document.querySelector('dialog[open]')
    if (!modal || modal.contains(this)) focus.call(this)
  })
  await mount(); menu(); fireEvent.click(screen.getByRole('button', { name: C.remove }))
  let dialog = screen.getByRole('dialog')
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: C.cancel }))
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull(); expect(patches()).toHaveLength(0)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: C.menu('Variant A') }))
  menu(); fireEvent.click(screen.getByRole('button', { name: C.remove }))
  dialog = screen.getByRole('dialog')
  const remove = within(dialog).getByRole('button', { name: C.remove })
  fireEvent.click(remove); fireEvent.click(remove)
  await screen.findByText(C.removed)
  expect(patches()).toHaveLength(1)
  expect(order).toEqual(['GET', 'GET', 'PATCH'])
  expect(doc.arms).toEqual([{ ...defaultArms('block')[0]!, weight: 100 }])
  expect(puck.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'replace', destinationIndex: 1, destinationZone: 'root:default-zone',
    data: { ...puck.item, props: { ...puck.item.props, variantA: [] } } })
  expect(screen.getByLabelText('Cached versions').textContent).toBe('control')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Original' })))
  // A later removal on this same binding must also restore focus after modal cleanup.
  fireEvent.click(screen.getByRole('button', { name: C.add }))
  await screen.findByRole('tab', { name: 'Variant A' })
  await waitFor(() => expect((screen.getByRole('button', { name: C.menu('Variant A') }) as HTMLButtonElement).disabled).toBe(false))
  menu(); fireEvent.click(screen.getByRole('button', { name: C.remove }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.remove }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'Variant A' })).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Original' })))
})

test('invalid weight total blocks PATCH; a second inline edit saves the split and Split evenly refetches', async () => {
  await mount()
  const original = screen.getByLabelText(C.weight('Original'))
  fireEvent.change(original, { target: { value: '60' } }); fireEvent.blur(original)
  expect(screen.getByRole('alert').textContent).toBe('Weights must add up to 100%. They add up to 110% now.')
  expect(patches()).toHaveLength(0)
  const variant = screen.getByLabelText(C.weight('Variant A'))
  fireEvent.change(variant, { target: { value: '40' } }); fireEvent.keyDown(variant, { key: 'Enter' })
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(doc.arms.map(arm => arm.weight)).toEqual([60, 40])
  await waitFor(() => expect((screen.getByRole('button', { name: C.split }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: C.split }))
  await waitFor(() => expect(patches()).toHaveLength(2))
  expect(doc.arms.map(arm => arm.weight)).toEqual([50, 50])
  expect(order).toEqual(['GET', 'GET', 'PATCH', 'GET', 'PATCH'])
})

test('stale-edit uses the fresh updatedAt, maps copy, and refetches without showing server text', async () => {
  await mount(); doc.updatedAt = 'fresh-stale'; refuse = { status: 409, code: 'stale-edit' }
  fireEvent.click(screen.getByRole('button', { name: C.add }))
  await screen.findByText(C.staleEdit)
  expect(patches()[0]![1]!.headers).toMatchObject({ 'x-xp-if-updated-at': 'fresh-stale' })
  expect(order).toEqual(['GET', 'GET', 'PATCH', 'GET'])
  expect(document.body.textContent).not.toContain('SECRET SERVER TEXT')
})

test.each([[403, 'forbidden', "You don't have permission to do this."], [500, 'unknown', C.writeError]] as const)('maps %s refusal to safe copy', async (status, code, message) => {
  await mount(); refuse = { status, code }
  fireEvent.click(screen.getByRole('button', { name: C.add }))
  await screen.findByText(message)
  expect(document.body.textContent).not.toContain('SECRET SERVER TEXT')
})

test.each(['running', 'decided', 'archived'] as const)('%s hides all version controls and explains why', async status => {
  doc.status = status; await mount()
  expect(screen.getByText(C.locked[status])).toBeTruthy()
  expect(screen.queryByRole('button', { name: C.add })).toBeNull()
  expect(screen.queryByRole('button', { name: /Options for/ })).toBeNull()
  expect(screen.queryByRole('spinbutton')).toBeNull()
  expect(screen.queryByRole('button', { name: C.split })).toBeNull()
})

test('a status changed since mount blocks the write using the fresh document', async () => {
  await mount(); doc.status = 'running'
  fireEvent.click(screen.getByRole('button', { name: C.add }))
  await screen.findByText(C.locked.running, { selector: '.xp-ui-help' })
  expect(patches()).toHaveLength(0)
  expect(screen.queryByRole('button', { name: C.add })).toBeNull()
})

test('readout shows exposed people per version and summary headline; Refresh fetches again without polling', async () => {
  doc.status = 'running'; await mount()
  await screen.findByText('Variant A is ahead')
  expect(screen.getByText('Original: 1,234 people')).toBeTruthy()
  expect(screen.getByText('Variant A: 1,456 people')).toBeTruthy()
  const link = screen.getByRole('link', { name: C.viewResults })
  expect(link.getAttribute('href')).toBe('/manage/experiments/builder-test/results'); expect(link.getAttribute('target')).toBe('_blank')
  vi.useFakeTimers()
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
  expect(order.filter(call => call === 'results')).toHaveLength(1)
  vi.useRealTimers()
  fireEvent.click(screen.getByRole('button', { name: C.refresh }))
  await waitFor(() => expect(order.filter(call => call === 'results')).toHaveLength(2))
  expect(order.filter(call => call === 'summary')).toHaveLength(2)
})

test('a null verdict and snapshot show Collecting with zero people', async () => {
  doc.status = 'stopped'; summary = { 'builder-test': { verdict: null } }; snapshot = null
  await mount(); await screen.findByText(C.collecting)
  expect(screen.getByText('Original: 0 people')).toBeTruthy()
})

test.each([403, 500])('results unavailable on %s retains the link', async status => {
  doc.status = 'running'; resultsStatus = status; await mount()
  await screen.findByText(C.resultsUnavailable)
  expect(screen.getByRole('link', { name: C.viewResults })).toBeTruthy()
})

test('a network readout failure retains the link; draft never requests results', async () => {
  await mount(); expect(order).toEqual(['GET'])
  cleanup(); doc.status = 'running'
  const fetcher = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith('/results')) throw new Error('offline')
    return fetcher(url, init)
  })
  await mount(); await screen.findByText(C.resultsUnavailable)
  expect(screen.getByRole('link', { name: C.viewResults })).toBeTruthy()
})


test('Split evenly wins over the pending inline edit when clicking it blurs the input', async () => {
  await mount()
  const original = screen.getByLabelText(C.weight('Original'))
  const variant = screen.getByLabelText(C.weight('Variant A'))
  fireEvent.change(original, { target: { value: '60' } })
  fireEvent.change(variant, { target: { value: '40' } })
  variant.focus()
  const split = screen.getByRole('button', { name: C.split })
  fireEvent.blur(variant, { relatedTarget: split }); fireEvent.click(split)
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(doc.arms.map(arm => arm.weight)).toEqual([50, 50])
  expect(order).toEqual(['GET', 'GET', 'PATCH'])
})

test('a delayed removal for a previous binding never overwrites the new document or clears its content', async () => {
  const view = await mount()
  const before = { ...doc, arms: doc.arms.slice(0, 1) }
  let finish!: (response: Response) => void
  const fetcher = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH') {
      order.push('PATCH')
      return new Promise<Response>(resolve => { finish = resolve })
    }
    return fetcher(url, init)
  })
  menu(); fireEvent.click(screen.getByRole('button', { name: C.remove }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.remove }))
  await waitFor(() => expect(order).toEqual(['GET', 'GET', 'PATCH']))
  doc = { ...doc, name: 'Second test' }
  view.rerender(editor('second-test'))
  await screen.findByRole('heading', { name: 'Second test' })
  await act(async () => finish(response({ doc: before })))
  expect(screen.getByRole('heading', { name: 'Second test' })).toBeTruthy()
  expect(screen.queryByText(C.removed)).toBeNull()
  expect(puck.dispatch).not.toHaveBeenCalled()
})

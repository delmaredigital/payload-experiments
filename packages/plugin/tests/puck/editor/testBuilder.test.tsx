// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { defaultArms } from '../../../src/arms/model.js'
import { useArms } from '../../../src/puck/editor/armsCache.js'
import { editorCopy as C } from '../../../src/puck/editor/copy.js'
import type { Arm, Status } from '../../../src/types/contracts.js'

const puck = vi.hoisted(() => ({ dispatch: vi.fn(), item: { type: 'ExperimentSlot', props: {
  id: 'builder', control: [{ type: 'Text', props: { id: 'original' } }], variantA: [{ type: 'Text', props: { id: 'variant' } }], variantB: [], variantC: [],
} }, missingItem: false, missingSelector: false, selection: 'other' as 'other' | 'none' }))

const selectedItem = () => puck.selection === 'other' ? { type: 'Text', props: { id: 'other-block' } } : null
vi.mock('@puckeditor/core', async importOriginal => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  return { ...await importOriginal<typeof import('@puckeditor/core')>(),
    createUsePuck: () => (selector: (state: unknown) => unknown) => selector({ selectedItem: selectedItem(), getItemById: () => puck.item,
      config: { components: {} }, appState: { data: { root: { props: {} }, content: [] } } }),
    useGetPuck: () => () => ({ selectedItem: selectedItem(), getItemById: () => puck.missingItem ? undefined : puck.item, dispatch: puck.dispatch,
      getSelectorForId: () => puck.missingSelector ? undefined : ({ index: 1, zone: 'root:default-zone' }) }),
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
function menu(label = 'Variant A') { fireEvent.click(screen.getByRole('tab', { name: label })); fireEvent.click(screen.getByRole('button', { name: `Options for ${label}` })) }
function patches() { return vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH') }
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  doc = { name: 'Example', status: 'draft', updatedAt: '2026-11-03T20:00:00.000Z', arms: defaultArms('block') }
  refuse = undefined; resultsStatus = 200; order = []
  summary = { 'builder-test': { verdict: { headline: 'Variant A is ahead' } } }
  snapshot = { exposures: { perArm: { control: 1234, variantA: 1456 } } }
  puck.missingItem = false; puck.missingSelector = false
  puck.selection = 'other'
  puck.dispatch.mockReset()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/xp/editor-surface')) return response({ canManage: true, canReadResults: true })
    if (url.endsWith('/preflight')) return response({ placements: [] })
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
    // The tab can mount before the selection effect flips it; wait for the selected state.
    await waitFor(() => expect(tab.getAttribute('aria-selected')).toBe('true'))
    expect(order.slice(start).filter(call => ['GET', 'PATCH'].includes(call))).toEqual(['GET', 'PATCH'])
    expect(patches().at(-1)).toEqual(['/host-api/xp-experiments/builder-test', expect.objectContaining({
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-xp-if-updated-at': timestamp },
      body: JSON.stringify({ arms: [...previous, { key, kind: 'variant', label, weight: 0, slot: key }] }),
    })])
    await waitFor(() => expect(screen.getByLabelText('Cached versions').textContent).toBe(doc.arms.map(arm => arm.key).join(',')))
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
  expect(screen.queryByRole('button', { name: C.removeVersion })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: C.rename }))
  const input = screen.getByLabelText(C.renameLabel)
  fireEvent.change(input, { target: { value: 'Current appeal' } }); fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByRole('tab', { name: 'Current appeal' })
  expect(doc.arms[0]).toMatchObject({ key: 'control', kind: 'control', slot: 'control' })
})

test.each(['other', 'none'] as const)('Remove focuses Cancel, confirms once and clears this slot with selection %s', async selection => {
  puck.selection = selection
  const focus = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
    // Model native showModal's inert outside content; jsdom's dialog shim does not.
    const modal = document.querySelector('dialog[open]')
    if (!modal || modal.contains(this)) focus.call(this)
  })
  await mount(); menu(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  let dialog = screen.getByRole('dialog')
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: C.cancel }))
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull(); expect(patches()).toHaveLength(0)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: C.menu('Variant A') }))
  menu(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
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
  menu(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.remove }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'Variant A' })).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Original' })))
})

test('editing one weight balances the others to 100 and Split evenly refetches', async () => {
  await mount()
  const original = screen.getByLabelText(C.weight('Original'))
  fireEvent.change(original, { target: { value: '60' } })
  expect((screen.getByLabelText(C.weight('Variant A')) as HTMLInputElement).value).toBe('40')
  fireEvent.blur(original)
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(doc.arms.map(arm => arm.weight)).toEqual([60, 40])
  expect(screen.queryByRole('alert')).toBeNull()
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

test('a fresh Remove dialog hides a failed Add error until its own attempt', async () => {
  await mount(); refuse = { status: 403, code: 'forbidden' }
  fireEvent.click(screen.getByRole('button', { name: C.add }))
  await screen.findByText("You don't have permission to do this.")
  menu(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).queryByRole('alert')).toBeNull()
  expect(patches()).toHaveLength(1)
  fireEvent.click(within(dialog).getByRole('button', { name: C.remove }))
  expect((await within(dialog).findByRole('alert')).textContent).toBe("You don't have permission to do this.")
  expect(patches()).toHaveLength(2)
})

test.each(['101', '-1', '50.5', ''])('invalid weight %j shows a field error without a misleading total or PATCH', async value => {
  await mount()
  const input = screen.getByLabelText(C.weight('Original'))
  fireEvent.change(input, { target: { value } })
  expect(input.getAttribute('aria-invalid')).toBe('true')
  const error = screen.getByRole('alert')
  expect(error.textContent).toBe(C.invalidShare)
  expect(input.getAttribute('aria-describedby')).toBe(error.id)
  expect(screen.queryByText(/They add up to/)).toBeNull()
  fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input)
  expect(patches()).toHaveLength(0)
  expect(order).toEqual(['GET'])
})

test.each(['running', 'decided', 'archived'] as const)('%s keeps Copy as its only menu action and explains locked controls', async status => {
  doc.status = status; await mount()
  expect(screen.getByText(C.locked[status])).toBeTruthy()
  expect(screen.queryByRole('button', { name: C.add })).toBeNull()
  menu()
  const options = screen.getByLabelText(C.menu('Variant A'), { selector: '.xp-slot-version-menu' })
  expect(within(options).getAllByRole('button').map(button => button.textContent)).toEqual([C.copy])
  if (status === 'running') expect(within(options).getByText(C.runningVersions)).toBeTruthy()
  expect(screen.queryByRole('button', { name: C.rename })).toBeNull()
  expect(screen.queryByRole('button', { name: C.removeVersion })).toBeNull()
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
  const link = screen.getByRole('button', { name: C.configure })
  expect(link.classList.contains('xp-ui-button--primary')).toBe(true)
  vi.useFakeTimers()
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
  expect(order.filter(call => call === 'results')).toHaveLength(1)
  vi.useRealTimers()
  fireEvent.click(screen.getByRole('button', { name: C.refresh }))
  await waitFor(() => expect(order.filter(call => call === 'results')).toHaveLength(2))
  expect(order.filter(call => call === 'summary')).toHaveLength(2)
})

test('a null verdict and snapshot show only Collecting without people', async () => {
  doc.status = 'stopped'; summary = { 'builder-test': { verdict: null } }; snapshot = null
  await mount(); await screen.findByText(C.collecting)
  expect(screen.queryByText(/people/)).toBeNull()
})

test.each([403, 500])('results unavailable on %s retains the link', async status => {
  doc.status = 'running'; resultsStatus = status; await mount()
  await screen.findByText(C.resultsUnavailable)
  expect(screen.getByRole('button', { name: C.configure })).toBeTruthy()
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
  expect(screen.getByRole('button', { name: C.configure })).toBeTruthy()
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
  menu(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
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


test.each([false, true])('Remove 409 announces mapped stale copy inside the still-open dialog (already removed: %s)', async alreadyRemoved => {
  await mount(); menu(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  refuse = { status: 409, code: 'stale-edit' }
  if (alreadyRemoved) {
    const fetcher = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const result = await fetcher(url, init)
      if (init?.method === 'PATCH') doc.arms = doc.arms.filter(arm => arm.key !== 'variantA')
      return result
    })
  }
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.remove }))
  const alert = await within(screen.getByRole('dialog')).findByRole('alert')
  expect(alert.textContent).toBe(C.staleEdit)
  expect(alert.classList.contains('xp-ui-error')).toBe(true)
  expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true)
  expect(puck.dispatch).not.toHaveBeenCalled()
})

test('menus close on outside pointerdown, focus leaving the wrapper, and Escape restores trigger focus', async () => {
  await mount(); menu()
  expect(screen.getByRole('button', { name: C.rename })).toBeTruthy()
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('button', { name: C.rename })).toBeNull()
  menu()
  const rename = screen.getByRole('button', { name: C.rename })
  fireEvent.blur(rename, { relatedTarget: screen.getByRole('button', { name: C.add }) })
  expect(screen.queryByRole('button', { name: C.rename })).toBeNull()
  menu()
  fireEvent.keyDown(screen.getByRole('button', { name: C.rename }), { key: 'Escape' })
  expect(screen.queryByRole('button', { name: C.rename })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: C.menu('Variant A') }))
})

test('a menu closes when focus leaves the canvas document or the window', async () => {
  await mount(); menu()
  expect(screen.getByRole('button', { name: C.rename })).toBeTruthy()
  fireEvent.blur(window)
  expect(screen.queryByRole('button', { name: C.rename })).toBeNull()
})

test('display contents preserves inside pointer paths and focus; null blur allows a menu click', async () => {
  const style = document.createElement('style')
  style.textContent = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../src/puck/editor/editor.chrome.css'), 'utf8')
  document.head.append(style)
  try {
    await mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Variant A' }))
    const trigger = screen.getByRole('button', { name: C.menu('Variant A') })
    trigger.focus(); fireEvent.click(trigger)
    const wrapper = trigger.closest('.xp-slot-version-actions')!
    expect(getComputedStyle(wrapper).display).toBe('contents')
    const group = screen.getByRole('group', { name: C.menu('Variant A') })
    expect(group.tabIndex).toBe(-1)
    act(() => group.focus())
    expect(document.activeElement).toBe(group)
    expect(screen.getByRole('button', { name: C.rename })).toBeTruthy()
    act(() => trigger.focus())
    const rename = screen.getByRole('button', { name: C.rename })
    fireEvent.pointerDown(rename)
    expect(screen.getByRole('group', { name: C.menu('Variant A') })).toBe(group)
    fireEvent.blur(trigger, { relatedTarget: null })
    expect(screen.getByRole('button', { name: C.rename })).toBe(rename)
    fireEvent.click(rename)
    expect(document.activeElement).toBe(screen.getByLabelText(C.renameLabel))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('group', { name: C.menu('Variant A') })).toBeNull()
  } finally { style.remove() }
})

test('opening a second version menu replaces the first and tablist owns only tabs, including during rename', async () => {
  await mount(); menu()
  expect(screen.getByLabelText(C.menu('Variant A'), { selector: '.xp-slot-version-menu' })).toBeTruthy()
  menu('Original')
  expect(screen.queryByLabelText(C.menu('Variant A'), { selector: '.xp-slot-version-menu' })).toBeNull()
  expect(document.querySelectorAll('.xp-slot-version-menu')).toHaveLength(1)
  const tablist = screen.getByRole('tablist')
  expect([...tablist.querySelectorAll('*')].every(node => node.getAttribute('role') === 'tab')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: C.rename }))
  const input = screen.getByLabelText(C.renameLabel)
  expect(input.closest('[role=tablist]')).toBeNull()
  expect(tablist.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(input.closest('.xp-slot-version-rename')?.parentElement).toBe(document.querySelector('.xp-slot-version-actions'))
  expect(input.closest('.xp-slot-version-anchor')).toBeNull()
  expect([...tablist.querySelectorAll('*')].every(node => node.getAttribute('role') === 'tab')).toBe(true)
})

test.each(['non-JSON', 'invalid shape', 'invalid arm', 'unknown status'] as const)('refetch handles %s with authored copy', async mode => {
  await mount()
  vi.mocked(fetch).mockResolvedValueOnce(mode === 'non-JSON' ? new Response('not json') : response(mode === 'invalid shape' ? {} :
    mode === 'invalid arm' ? { ...doc, arms: [null] } : { ...doc, status: 'unknown' }))
  fireEvent.click(screen.getByRole('button', { name: C.add }))
  expect((await screen.findByRole('alert')).textContent).toBe(mode === 'unknown status' ? C.lockedGeneric : C.writeUnreadable)
  expect(patches()).toHaveLength(0)
})

test.each(['missingItem', 'missingSelector'] as const)('successful Remove explains when content cannot be cleared: %s', async missing => {
  await mount(); menu(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  puck[missing] = true
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.remove }))
  expect((await screen.findByRole('alert')).textContent).toBe(C.removeUncleared)
  expect(patches()).toHaveLength(1)
  expect(puck.dispatch).not.toHaveBeenCalled()
})

test('rebinding hides an uncleared-content error from the previous binding', async () => {
  const view = await mount(); menu(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  puck.missingSelector = true
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.remove }))
  await screen.findByText(C.removeUncleared)
  doc = { ...doc, name: 'Second test' }
  view.rerender(editor('second-test'))
  await screen.findByRole('heading', { name: 'Second test' })
  expect(screen.queryByText(C.removeUncleared)).toBeNull()
})

test('the next successful write clears an uncleared-content error on the same binding', async () => {
  await mount(); menu(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  puck.missingSelector = true
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.remove }))
  await screen.findByText(C.removeUncleared)
  puck.missingSelector = false
  fireEvent.click(screen.getByRole('button', { name: C.add }))
  await screen.findByRole('tab', { name: 'Variant A' })
  await waitFor(() => expect((screen.getByRole('button', { name: C.add }) as HTMLButtonElement).disabled).toBe(false))
  expect(patches()).toHaveLength(2)
  expect(screen.queryByText(C.removeUncleared)).toBeNull()
})

test('holdout people follow compared versions with the not compared note', async () => {
  doc.status = 'running'
  doc.arms.splice(1, 0, { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 })
  snapshot = { exposures: { perArm: { control: 1234, variantA: 1456, holdout: 100 } } }
  await mount()
  await screen.findByText('Holdout: 100 people (not compared)')
  expect([...document.querySelectorAll('.xp-slot-people span')].map(node => node.textContent)).toEqual([
    'Original: 1,234 people', 'Variant A: 1,456 people', 'Holdout: 100 people (not compared)',
  ])
})

test('a successful in-flight arm write clears a document-refetch error', async () => {
  await mount()
  let complete!: (response: Response) => void
  let refetch = false
  vi.mocked(fetch).mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (String(_url).endsWith('/xp/editor-surface')) return response({ canManage: true, canReadResults: true })
    if (init?.method === 'PATCH') return new Promise(resolve => { complete = resolve })
    if (refetch) throw new Error('offline')
    return response(doc)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))
  await waitFor(() => expect(complete).toBeTypeOf('function'))
  refetch = true
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  await screen.findByText(C.loadError)
  await act(async () => { complete(response({ doc: { ...doc, arms: [...doc.arms, { key: 'variantB', kind: 'variant', label: 'Variant B', slot: 'variantB', weight: 0 }] } })) })
  await screen.findByRole('tab', { name: 'Variant B' })
  expect(screen.queryByText(C.loadError)).toBeNull()
})

test('four populated page versions remain reachable when bound to a two-version test', async () => {
  puck.item.props.variantB = [{ type: 'Text', props: { id: 'leftover-b' } }] as never[]
  puck.item.props.variantC = [{ type: 'Text', props: { id: 'leftover-c' } }] as never[]
  try {
    await mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Variant B · not in this test' }))
    expect(screen.getByText('B content')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Add to the test' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Delete its content' })).toHaveLength(2)
  } finally { puck.item.props.variantB = []; puck.item.props.variantC = [] }
})

test.each(['draft', 'running', 'stopped', 'decided', 'archived'] as const)('leftover actions respect %s and delete confirms the page block count without changing the test', async status => {
  doc.status = status
  puck.item.props.variantB = [{ type: 'Text', props: { id: 'leftover-b' } }] as never[]
  try {
    await mount()
    expect(screen.queryByRole('button', { name: 'Add to the test' }) !== null).toBe(status === 'draft')
    fireEvent.click(screen.getByRole('button', { name: 'Delete its content' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Delete Variant B content?' })).toBeTruthy()
    expect(within(dialog).getByText(/1 block in Variant B/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(puck.dispatch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete its content' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete its content' }))
    expect(patches()).toHaveLength(0)
    expect(puck.dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'replace', data: expect.objectContaining({ props: expect.objectContaining({ variantB: [], variantA: puck.item.props.variantA }) }) }))
  } finally { puck.item.props.variantB = [] }
})
test('Add to the test keeps content and adds the named leftover using a fresh guarded write', async () => {
  puck.item.props.variantC = [{ type: 'Text', props: { id: 'leftover-c' } }] as never[]
  try {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add to the test' }))
    await screen.findByRole('tab', { name: 'Variant C' })
    expect(doc.arms.map(arm => arm.key)).toEqual(['control', 'variantA', 'variantC'])
    expect(patches()).toHaveLength(1)
    expect(puck.dispatch).not.toHaveBeenCalled()
    expect(puck.item.props.variantC).toHaveLength(1)
  } finally { puck.item.props.variantC = [] }
})
test('more than two leftover versions share one notice with per-version actions', async () => {
  doc.arms = [{ ...doc.arms[0]!, weight: 100 }]
  puck.item.props.variantB = [{ type: 'Text', props: { id: 'b' } }] as never[]
  puck.item.props.variantC = [{ type: 'Text', props: { id: 'c' } }] as never[]
  try {
    await mount()
    expect(document.querySelectorAll('.xp-slot-leftovers')).toHaveLength(1)
    expect(document.querySelector('details.xp-slot-leftovers')?.hasAttribute('open')).toBe(false)
    fireEvent.click(screen.getByText(/3 versions have content/))
    expect(puck.dispatch).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'Add to the test' })).toHaveLength(3)
  } finally { puck.item.props.variantB = []; puck.item.props.variantC = [] }
})

test('copying an empty Original has a visible reason next to the disabled action', async () => {
  const content = puck.item.props.control
  puck.item.props.control = []
  try {
    await mount(); menu()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: C.copy }).disabled).toBe(true)
    expect(screen.getByText(C.copyEmpty)).toBeTruthy()
  } finally { puck.item.props.control = content }
})
test('leftover Add checks draft status again before writing', async () => {
  puck.item.props.variantB = [{ type: 'Text', props: { id: 'b' } }] as never[]
  try {
    await mount(); doc.status = 'stopped'
    fireEvent.click(screen.getByRole('button', { name: C.addLeftover }))
    await screen.findByText(C.draftOnly)
    expect(patches()).toHaveLength(0)
  } finally { puck.item.props.variantB = [] }
})

test('page editors without test management can delete leftover content but cannot add a test version', async () => {
  puck.item.props.variantB = [{ type: 'Text', props: { id: 'b' } }] as never[]
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/xp/editor-surface')
    ? response({ canManage: false, canReadResults: true }) : original(url, init))
  try {
    await mount()
    expect(screen.queryByRole('button', { name: C.addLeftover })).toBeNull()
    expect(screen.getByRole('button', { name: C.deleteContent })).toBeTruthy()
  } finally { puck.item.props.variantB = [] }
})


test('every tab has a labelled visible menu before selection or hover; removal names content and shared impact', async () => {
  await mount()
  expect(screen.getByRole('tab', { name: 'Original' }).getAttribute('aria-selected')).toBe('true')
  const trigger = screen.getByRole('button', { name: C.menu('Variant A') })
  expect(trigger.textContent).toBe('Options ▾')
  expect(trigger.closest('.xp-ui-tab-with-actions')?.querySelector('[role="tab"]')?.textContent).toBe('Variant A')
  fireEvent.click(trigger)
  expect(screen.getByRole('tab', { name: 'Original' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  expect(within(screen.getByRole('dialog')).getByText(C.removeHelp(1))).toBeTruthy()
})


test('removing a version also explains its effect on other pages', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight')
    ? Promise.resolve(response({ checks: [], placements: [{ collection: 'pages', id: 'another', detail: 'Published' }] })) : originalFetch(url, init))
  await mount()
  await screen.findByText(C.sharedTest)
  menu(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  expect(within(screen.getByRole('dialog')).getByText(C.removeShared)).toBeTruthy()
})

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
} }, missingItem: false, missingSelector: false, selection: 'other' as 'other' | 'none' }))

const selectedItem = () => puck.selection === 'other' ? { type: 'Text', props: { id: 'other-block' } } : null
vi.mock('@puckeditor/core', async importOriginal => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  return { ...await importOriginal<typeof import('@puckeditor/core')>(),
    FieldGroup: ({ children, label }: { children: import('react').ReactNode; label?: string }) => <div>{label}{children}</div>,
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
vi.mock('../../../src/puck/editor/sidebar.js', () => ({ TestSidebarField: () => null, useSidebarTargets: () => targets }))
let targets: { test: HTMLElement; controls: HTMLElement; onChange: ReturnType<typeof vi.fn> }
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
function selectVersion(label = 'Variant A') { fireEvent.click(screen.getByRole('tab', { name: label })) }
function patches() { return vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH') }
beforeEach(() => {
  targets = { test: document.createElement('div'), controls: document.createElement('div'), onChange: vi.fn() }; document.body.append(targets.test, targets.controls)
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
    if (url.endsWith('/preflight')) return response({ placements: [], checks: [] })
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
afterEach(() => { cleanup(); targets.test.remove(); targets.controls.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

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

test.each(['other', 'none'] as const)('Remove focuses Cancel, confirms once and clears this slot with selection %s', async selection => {
  puck.selection = selection
  const focus = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
    // Model native showModal's inert outside content; jsdom's dialog shim does not.
    const modal = document.querySelector('dialog[open]')
    if (!modal || modal.contains(this)) focus.call(this)
  })
  await mount(); selectVersion(); screen.getByRole('button', { name: C.removeVersion }).focus(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  let dialog = screen.getByRole('dialog')
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: C.cancel }))
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull(); expect(patches()).toHaveLength(0)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: C.removeVersion }))
  selectVersion(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
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
  await waitFor(() => expect((screen.getByRole('button', { name: C.removeVersion }) as HTMLButtonElement).disabled).toBe(false))
  selectVersion(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
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
  selectVersion(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
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
  selectVersion(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
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


test('an in-flight Remove refusal cannot reopen a dialog closed by rebinding', async () => {
  const view = await mount()
  let finish!: () => void
  const fetcher = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'PATCH'
    ? new Promise(resolve => { finish = () => resolve(response({}, 403)) }) : fetcher(url, init))
  selectVersion(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.remove }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  doc = { ...doc, name: 'Second test' }
  view.rerender(editor('second-test'))
  await screen.findByRole('heading', { name: 'Second test' })
  expect(screen.queryByRole('dialog')).toBeNull()
  await act(async () => finish())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

test.each([false, true])('Remove 409 announces mapped stale copy inside the still-open dialog (already removed: %s)', async alreadyRemoved => {
  await mount(); selectVersion(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
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

test('retrying refused Remove after the version disappears sends no PATCH and preserves 70/30', async () => {
  doc.arms.push({ key: 'variantB', slot: 'variantB', kind: 'variant', label: 'Variant B', weight: 0 })
  await mount()
  const row = screen.getByRole('group', { name: 'Variant B' })
  fireEvent.click(within(row).getByRole('button', { name: C.removeVersion }))
  const dialog = screen.getByRole('dialog')
  const fetcher = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH') {
      doc = { ...doc, updatedAt: 'colleague-edit', arms: doc.arms.filter(arm => arm.key !== 'variantB').map((arm, i) => ({ ...arm, weight: i ? 30 : 70 })) }
      return response({ errors: [{ code: 'stale-edit' }] }, 409)
    }
    return fetcher(url, init)
  })
  fireEvent.click(within(dialog).getByRole('button', { name: C.remove }))
  expect((await within(dialog).findByRole('alert')).textContent).toBe(C.staleEdit)
  await waitFor(() => expect(within(dialog).getByRole('button', { name: C.remove }).getAttribute('aria-disabled')).toBeNull())
  const before = structuredClone(doc.arms)
  vi.mocked(fetch).mockClear()
  vi.mocked(fetch).mockImplementation(fetcher)
  fireEvent.click(within(dialog).getByRole('button', { name: C.remove }))
  await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(C.staleEdit))
  expect(patches()).toHaveLength(0)
  expect(doc.arms).toEqual(before)
  expect(doc.arms.map(arm => arm.weight)).toEqual([70, 30])
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(puck.dispatch).not.toHaveBeenCalled()
})

test.each(['Traffic', 'Add', 'leftover Add', 'Name'] as const)('%s refuses a fresh document whose target or precondition disappeared', async intent => {
  if (intent === 'leftover Add') puck.item.props.variantB = [{ type: 'Text', props: { id: 'b' } }] as never[]
  try {
    await mount()
    if (intent === 'Traffic' || intent === 'Name') {
      const input = screen.getByRole(intent === 'Traffic' ? 'spinbutton' : 'textbox', { name: intent === 'Traffic' ? C.weight('Variant A') : 'Variant A Name' })
      fireEvent.change(input, { target: { value: intent === 'Traffic' ? '60' : 'New name' } })
      doc = { ...doc, arms: [{ ...doc.arms[0]!, weight: 100 }] }
      fireEvent.keyDown(input, { key: 'Enter' })
    } else {
      doc = { ...doc, arms: [...doc.arms, { key: 'variantB', slot: 'variantB', kind: 'variant', label: 'Variant B', weight: 0 },
        ...(intent === 'Add' ? [{ key: 'variantC' as const, slot: 'variantC' as const, kind: 'variant' as const, label: 'Variant C', weight: 0 }] : [])] }
      fireEvent.click(screen.getByRole('button', { name: intent === 'Add' ? C.add : C.addLeftover }))
    }
    // The fresh read can remove the originating control and its inline error.
    await waitFor(() => expect(order.filter(call => call === 'GET')).toHaveLength(2))
    await waitFor(() => expect(screen.queryByText(C.savingVersions)).toBeNull())
    expect(patches()).toHaveLength(0)
    expect(puck.dispatch).not.toHaveBeenCalled()
  } finally { puck.item.props.variantB = [] }
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
  await mount(); selectVersion(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  puck[missing] = true
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.remove }))
  expect((await screen.findByRole('alert')).textContent).toBe(C.removeUncleared)
  expect(patches()).toHaveLength(1)
  expect(puck.dispatch).not.toHaveBeenCalled()
})

test('rebinding hides an uncleared-content error from the previous binding', async () => {
  const view = await mount(); selectVersion(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  puck.missingSelector = true
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: C.remove }))
  await screen.findByText(C.removeUncleared)
  doc = { ...doc, name: 'Second test' }
  view.rerender(editor('second-test'))
  await screen.findByRole('heading', { name: 'Second test' })
  expect(screen.queryByText(C.removeUncleared)).toBeNull()
})

test('the next successful write clears an uncleared-content error on the same binding', async () => {
  await mount(); selectVersion(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
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
    if (String(_url).endsWith('/preflight')) return response({ placements: [], checks: [] })
    if (init?.method === 'PATCH') return new Promise(resolve => { complete = resolve })
    if (refetch) throw new Error('offline')
    return response(doc)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))
  await waitFor(() => expect(complete).toBeTypeOf('function'))
  refetch = true
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  await screen.findAllByText("Couldn't load this test. Try selecting it again.")
  await act(async () => { complete(response({ doc: { ...doc, arms: [...doc.arms, { key: 'variantB', kind: 'variant', label: 'Variant B', slot: 'variantB', weight: 0 }] } })) })
  await screen.findByRole('tab', { name: 'Variant B' })
  expect(screen.queryByText("Couldn't load this test. Try selecting it again.")).toBeNull()
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
test('copying an empty Original has a visible reason next to the disabled action', async () => {
  const content = puck.item.props.control
  puck.item.props.control = []
  try {
    await mount(); selectVersion()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: C.copy() }).disabled).toBe(true)
    expect(screen.getByText(C.copyEmpty())).toBeTruthy()
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

test('removing a version also explains its effect on other pages', async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight')
    ? Promise.resolve(response({ checks: [], placements: [{ collection: 'pages', id: 'another', detail: 'Published' }] })) : originalFetch(url, init))
  await mount()
  await screen.findAllByText(C.sharedTest)
  selectVersion(); fireEvent.click(screen.getByRole('button', { name: C.removeVersion }))
  expect(within(screen.getByRole('dialog')).getByText(C.removeShared)).toBeTruthy()
})

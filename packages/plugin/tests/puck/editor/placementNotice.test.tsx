// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, type Config } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { newTestBody } from '../../../src/puck/editor/editor.model.js'
import { SAVE_PAGE, PUBLISH_PAGE, RUNNING_SAVE_PAGE, RUNNING_PUBLISH_PAGE } from '../../../src/testSurface/surface/editorPlacement.js'
import { usePlacementNotice } from '../../../src/puck/editor/usePlacementNotice.js'
import { acquirePlacements, refreshPlacements } from '../../../src/puck/editor/placementsCache.js'
import { ConfigureTestDrawer } from '../../../src/puck/editor/ConfigureTestDrawer.js'
import { useEffect, useState } from 'react'

const doc = { ...newTestBody({ kind: 'block', name: 'Notice test', slug: 'notice', unitType: 'visitor' }), id: 'notice-test', status: 'draft', updatedAt: 'now' }
let saved: boolean
let published: boolean
let hidden: boolean
const block = (id: string) => ({ type: 'ExperimentSlot', props: { id, experiment: { id: doc.id, slug: doc.slug }, control: [], variantA: [], variantB: [], variantC: [] } })
const requests = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/preflight')).length
beforeEach(() => {
  saved = false; published = false; hidden = false; doc.status = 'draft'
  history.replaceState({}, '', '/admin/puck/pages/123')
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible')
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/editor-surface')
    ? { canManage: true, canReadResults: true, flagPoints: [], pageCollections: [], attributeKeys: {}, metricSources: [] }
    : url.includes('/xp-metrics?') ? { docs: [] } : url.includes('/results') ? { phases: [], snapshot: null } : url.includes('/summary?') ? {} : url.endsWith('/preflight') ? { placements: saved ? [{ collection: 'pages', id: '123', editorUrl: '/custom/editor/123', detail: published ? 'Published' : 'Draft' }] : [], checks: [] }
      : url.includes('/xp-experiments?') ? { docs: [doc] } : doc)))
})
afterEach(async () => { cleanup(); await act(async () => {}); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState({}, '', '/') })
function editor(count = 1) {
  const config: Config = { components: { ExperimentSlot: ExperimentSlotEditor } }
  return render(<Puck config={config} data={{ root: { props: {} }, content: Array.from({ length: count }, (_, index) => block(`notice-${index}`)) }} iframe={{ enabled: false }}><Puck.Preview /></Puck>)
}

test.each(['draft', 'running'])('save then publish clears %s chrome guidance without a focus change and stops its timer', async status => {
  doc.status = status
  const saveMessage = status === 'running' ? RUNNING_SAVE_PAGE : SAVE_PAGE
  const publishMessage = status === 'running' ? RUNNING_PUBLISH_PAGE : PUBLISH_PAGE
  vi.useFakeTimers()
  editor()
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  expect(screen.getByText(saveMessage)).toBeTruthy()
  saved = true
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.queryByText(saveMessage)).toBeNull()
  expect(screen.getByText(publishMessage)).toBeTruthy()
  published = true
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.queryByText(publishMessage)).toBeNull()
  const after = requests()
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
  expect(requests()).toBe(after)
})

// This harness installs fake timers before the first notice so timer counts do
// not include Puck's unrelated animation/frame timers.
function Notice({ id = 'shared', show = true }: { id?: string; show?: boolean }) {
  const [resolved, setResolved] = useState(false)
  useEffect(() => acquirePlacements('/api', id, placements => {
    if (placements) setResolved(placements.some(page => page.detail === 'Published'))
  }), [id])
  usePlacementNotice('/api', id, show && !resolved ? SAVE_PAGE : undefined)
  return <p>{resolved ? 'Ready' : 'Waiting'}</p>
}

test('one shared timer and request for several mounted notices; resolves and stops', async () => {
  vi.useFakeTimers()
  const view = render(<><Notice /><Notice /><Notice /></>)
  await act(async () => {})
  expect(vi.getTimerCount()).toBe(1)
  expect(requests()).toBe(1)
  saved = published = true
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(requests()).toBe(2)
  expect(screen.getAllByText('Ready')).toHaveLength(3)
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
  expect(requests()).toBe(2)
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

test('no requests without a notice; hidden tabs and unmounted notices stop polling', async () => {
  vi.useFakeTimers()
  const view = render(<Notice show={false} />)
  await act(async () => {})
  const initial = requests()
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
  expect(requests()).toBe(initial)
  view.rerender(<Notice />)
  hidden = true; fireEvent(document, new Event('visibilitychange'))
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
  expect(requests()).toBe(initial)
  hidden = false; fireEvent(document, new Event('visibilitychange'))
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(requests()).toBe(initial + 1)
  view.unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
  expect(requests()).toBe(initial + 1)
  expect(vi.getTimerCount()).toBe(0)
})

test('an open drawer clears the save notice through the same cache without focus changes', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.useFakeTimers()
  const view = render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  await act(async () => {})
  const drawer = screen.getByRole('dialog')
  expect(within(drawer).getAllByText(SAVE_PAGE)).toHaveLength(2)
  saved = published = true
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(within(drawer).queryAllByText(SAVE_PAGE)).toHaveLength(0)
  const after = requests()
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000) })
  expect(requests()).toBe(after)
  view.unmount()
})


test.each([false, true])('a failed refresh replaces retained guidance with its failure (drawer: %s)', async drawer => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.useFakeTimers()
  if (drawer) render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  else editor()
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  expect(screen.getAllByText(SAVE_PAGE).length).toBeGreaterThan(0)
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight') ? new Promise(resolve => { finish = resolve }) : original(url, init))
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.getAllByText(SAVE_PAGE).length).toBeGreaterThan(0)
  expect(screen.queryByText('Checking readiness…')).toBeNull()
  await act(async () => { finish(Response.json({ placements: [], checks: [{ code: 'no-placements', ok: false, detail: 'placements-failed' }] })) })
  expect(screen.queryByText(SAVE_PAGE)).toBeNull()
  expect(screen.getAllByText("Couldn't check where this test is used. Try again.").length).toBeGreaterThan(0)
})

test.each(['draft', 'stopped', 'running', 'decided', 'archived'])('chrome, sidebar and drawer use status-aware guidance for %s', async status => {
  doc.status = status
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  const expected = status === 'draft' || status === 'stopped' ? SAVE_PAGE : status === 'running' ? "This test is running, but visitors won't see it here until this page is saved and published." : undefined
  const view = render(<Puck config={{ components: { ExperimentSlot: ExperimentSlotEditor } }} data={{ root: { props: {} }, content: [block('notice-0')] }} iframe={{ enabled: false }} ui={{ itemSelector: { index: 0, zone: 'root:default-zone' } }}><Puck.Preview /><Puck.Fields /></Puck>)
  await screen.findByRole('heading', { name: 'Notice test' })
  await act(async () => {})
  if (expected) {
    expect(screen.getAllByText(expected)).toHaveLength(2)
    for (const notice of screen.getAllByText(expected)) expect(notice.closest(status === 'running' ? '.xp-ui-banner--warning' : '.xp-ui-banner--error')).toBeTruthy()
  }
  else expect(screen.queryByText(SAVE_PAGE)).toBeNull()
  view.unmount()
  const drawer = render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  await screen.findByRole('heading', { name: 'Notice test' })
  await act(async () => {})
  if (expected) {
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
    if (status === 'running') expect(screen.getByText(expected).closest('.xp-ui-banner--warning')).toBeTruthy()
  }
  else expect(screen.queryByText(SAVE_PAGE)).toBeNull()
  drawer.unmount()
})

test('custom editorUrl placements identify this page in both chrome and drawer', async () => {
  saved = true
  history.replaceState({}, '', '/custom/editor/123')
  const view = editor()
  expect(await screen.findByText(PUBLISH_PAGE)).toBeTruthy()
  view.unmount()
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  expect((await screen.findAllByText(PUBLISH_PAGE)).length).toBeGreaterThan(0)
  expect(screen.queryByText(SAVE_PAGE)).toBeNull()
})

test.each([false, true])('a rejected placement read replaces retained guidance (drawer: %s)', async drawer => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.useFakeTimers()
  if (drawer) render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  else editor()
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  expect(screen.getAllByText(SAVE_PAGE).length).toBeGreaterThan(0)
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight') ? Promise.reject(new Error('offline')) : original(url, init))
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.queryByText(SAVE_PAGE)).toBeNull()
  const failure = drawer ? "Couldn't check readiness. Try again." : "Couldn't check where this test is used. Try again."
  expect(screen.getAllByText(failure).length).toBeGreaterThan(0)
  saved = published = true
  vi.mocked(fetch).mockImplementation(original)
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.queryByText(failure)).toBeNull()
  const recovered = requests()
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
  expect(requests()).toBe(recovered)
})


test('a successful shared retry clears the drawer focus error and restores current guidance', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.useFakeTimers()
  render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  const original = vi.mocked(fetch).getMockImplementation()!
  let failing = true
  vi.mocked(fetch).mockImplementation((url, init) => failing && String(url).endsWith('/preflight') ? Promise.reject(new Error('offline')) : original(url, init))
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001) })
  fireEvent(window, new Event('focus'))
  await act(async () => {})
  expect(screen.queryByText(SAVE_PAGE)).toBeNull()
  expect(screen.getAllByText("Couldn't check readiness. Try again.").length).toBeGreaterThan(0)
  failing = false
  await act(async () => { await refreshPlacements('/api', doc.id) })
  expect(screen.queryByText("Couldn't check readiness. Try again.")).toBeNull()
  expect(screen.getAllByText(SAVE_PAGE).length).toBeGreaterThan(0)
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight') ? new Promise(resolve => { finish = resolve }) : original(url, init))
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.queryByText("Couldn't check readiness. Try again.")).toBeNull()
  expect(screen.queryByText('Checking readiness…')).toBeNull()
  expect(screen.getAllByText(SAVE_PAGE).length).toBeGreaterThan(0)
  await act(async () => { finish(Response.json({ placements: [], checks: [] })) })
})


test.each([false, true].flatMap(drawer => ['network', 'abort', 'http', 'malformed'].map(transport => ({ drawer, transport }))))('failed placement notices recover with visible-only backoff and stop on success ($transport, drawer: $drawer)', async ({ drawer, transport }) => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.useFakeTimers()
  const view = drawer ? render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />) : editor(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  const original = vi.mocked(fetch).getMockImplementation()!
  let failing = true
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (!failing || !String(url).endsWith('/preflight')) return original(url, init)
    if (transport === 'http') return Promise.resolve(Response.json({}, { status: 500 }))
    if (transport === 'malformed') return Promise.resolve(Response.json({ placements: [] }))
    return Promise.reject(transport === 'abort' ? new DOMException('Aborted', 'AbortError') : new Error('offline'))
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  const failure = drawer ? "Couldn't check readiness. Try again." : "Couldn't check where this test is used. Try again."
  expect(screen.getAllByText(failure).length).toBeGreaterThan(0)
  let count = requests()
  for (const delay of [4_000, 8_000, 16_000, 30_000, 30_000]) {
    await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1) })
    expect(requests()).toBe(count)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(requests()).toBe(++count)
    expect(screen.getAllByText(failure).length).toBeGreaterThan(0)
  }
  hidden = true; fireEvent(document, new Event('visibilitychange'))
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
  expect(requests()).toBe(count)
  failing = false; saved = published = true
  await act(async () => { hidden = false; fireEvent(document, new Event('visibilitychange')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(requests()).toBe(count + 1)
  expect(screen.queryByText(failure)).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
  expect(requests()).toBe(count + 1)
  view.unmount()
})

test.each([401, 403, 'forbidden', 'not-found'] as const)('permanent refusal %s has no retry or automatic polling in chrome, sidebar or drawer', async status => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.useFakeTimers()
  const view = render(<Puck config={{ components: { ExperimentSlot: ExperimentSlotEditor } }} data={{ root: { props: {} }, content: [block('notice-0')] }} iframe={{ enabled: false }} ui={{ itemSelector: { index: 0, zone: 'root:default-zone' } }}><Puck.Preview /><Puck.Fields /></Puck>)
  const drawer = render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight') ? Promise.resolve(typeof status === 'string'
    ? Response.json({ placements: [], checks: [{ code: 'no-placements', ok: false, detail: status }] }) : Response.json({}, { status })) : original(url, init))
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.getAllByText(status === 'not-found' ? "A page used by this test no longer exists. Choose another page." : "You don't have permission to check where this test is used.").length).toBeGreaterThanOrEqual(3)
  expect(screen.queryByRole('button', { name: /^(Retry|Try again)$/ })).toBeNull()
  expect(screen.queryByText("Couldn't check where this test is used. Try again.")).toBeNull()
  const count = requests()
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
  expect(requests()).toBe(count)
  drawer.unmount(); view.unmount()
})

test('a new notice keeps its four-second schedule beside a backed-off or stalled test', async () => {
  vi.useFakeTimers()
  vi.mocked(fetch).mockImplementation(async url => {
    if (String(url).includes('/slow/preflight')) {
      const count = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/slow/preflight')).length
      if (count >= 5) return new Promise<Response>(() => {})
      throw new Error('offline')
    }
    return Response.json({ placements: [], checks: [] })
  })
  const calls = (id: string) => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes(`/${id}/preflight`)).length
  const view = render(<><Notice id="slow" /></>)
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(29_000) })
  expect(calls('slow')).toBe(4)
  view.rerender(<><Notice id="slow" /><Notice id="new" /></>)
  await act(async () => {})
  expect(calls('new')).toBe(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(calls('new')).toBe(2)
  expect(calls('slow')).toBe(4)
  await act(async () => { await vi.advanceTimersByTimeAsync(25_000) })
  expect(calls('slow')).toBe(5)
  const before = calls('new')
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(calls('new')).toBe(before + 1)
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})


test('a usable placements-failed answer keeps its own sentence in chrome, sidebar and drawer without transport backoff', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.useFakeTimers()
  const view = render(<Puck config={{ components: { ExperimentSlot: ExperimentSlotEditor } }} data={{ root: { props: {} }, content: [block('notice-0')] }} iframe={{ enabled: false }} ui={{ itemSelector: { index: 0, zone: 'root:default-zone' } }}><Puck.Preview /><Puck.Fields /></Puck>)
  const drawer = render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/preflight')
    ? Promise.resolve(Response.json({ placements: [], checks: [{ code: 'no-placements', ok: false, detail: 'placements-failed' }] })) : original(url, init))
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = requests()
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(requests()).toBe(before + 1)
    expect(screen.getAllByText("Couldn't check where this test is used. Try again.").length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText("Couldn't check readiness. Try again.")).toBeNull()
  }
  drawer.unmount(); view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, type Config } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { newTestBody } from '../../../src/puck/editor/editor.model.js'
import { SAVE_PAGE, PUBLISH_PAGE } from '../../../src/testSurface/surface/editorPlacement.js'
import { usePlacementNotice } from '../../../src/puck/editor/usePlacementNotice.js'
import { acquirePlacements } from '../../../src/puck/editor/placementsCache.js'
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
    : url.includes('/results') ? { phases: [], snapshot: null } : url.includes('/summary?') ? {} : url.endsWith('/preflight') ? { placements: saved ? [{ collection: 'pages', id: '123', editorUrl: '/custom/editor/123', detail: published ? 'Published' : 'Draft' }] : [], checks: [] }
      : url.includes('/xp-experiments?') ? { docs: [doc] } : doc)))
})
afterEach(async () => { cleanup(); await act(async () => {}); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState({}, '', '/') })
function editor(count = 1) {
  const config: Config = { components: { ExperimentSlot: ExperimentSlotEditor } }
  return render(<Puck config={config} data={{ root: { props: {} }, content: Array.from({ length: count }, (_, index) => block(`notice-${index}`)) }} iframe={{ enabled: false }}><Puck.Preview /></Puck>)
}

test('save then publish clears chrome guidance without a focus change and stops its timer', async () => {
  vi.useFakeTimers()
  editor()
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  expect(screen.getByText(SAVE_PAGE)).toBeTruthy()
  saved = true
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.queryByText(SAVE_PAGE)).toBeNull()
  expect(screen.getByText(PUBLISH_PAGE)).toBeTruthy()
  published = true
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.queryByText(PUBLISH_PAGE)).toBeNull()
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
  const interval = vi.spyOn(globalThis, 'setInterval')
  const view = render(<><Notice /><Notice /><Notice /></>)
  await act(async () => {})
  expect(interval).toHaveBeenCalledTimes(1)
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


test('a delayed or failed poll keeps the notice and retries until placements resolve', async () => {
  vi.useFakeTimers()
  editor()
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: (response: Response) => void
  let polling = 0
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).endsWith('/preflight')) {
      if (polling++ === 0) return Promise.reject(new Error('offline'))
      if (polling === 2) return new Promise(resolve => { finish = resolve })
    }
    return original(url, init)
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.getByText(SAVE_PAGE)).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(screen.getByText(SAVE_PAGE)).toBeTruthy()
  await act(async () => { finish(Response.json({ placements: [{ collection: 'pages', id: '123', detail: 'Published' }], checks: [] })) })
  expect(screen.queryByText(SAVE_PAGE)).toBeNull()
})

test.each(['draft', 'stopped', 'running', 'decided', 'archived'])('chrome, sidebar and drawer use status-aware guidance for %s', async status => {
  doc.status = status
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  const expected = status === 'draft' || status === 'stopped' ? SAVE_PAGE : status === 'running' ? "This test is running, but visitors won't see it here until this page is saved and published." : undefined
  const view = render(<Puck config={{ components: { ExperimentSlot: ExperimentSlotEditor } }} data={{ root: { props: {} }, content: [block('notice-0')] }} iframe={{ enabled: false }} ui={{ itemSelector: { index: 0, zone: 'root:default-zone' } }}><Puck.Preview /><Puck.Fields /></Puck>)
  await screen.findByRole('heading', { name: 'Notice test' })
  await act(async () => {})
  if (expected) expect(screen.getAllByText(expected)).toHaveLength(2)
  else expect(screen.queryByText(SAVE_PAGE)).toBeNull()
  view.unmount()
  const drawer = render(<ConfigureTestDrawer id={doc.id} routes={{ api: '/api', admin: '/admin' }} onClose={() => {}} />)
  await screen.findByRole('heading', { name: 'Notice test' })
  await act(async () => {})
  if (expected) expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
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

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, useGetPuck, type Config } from '@puckeditor/core'
import { createExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { openConfigureTestDrawer } from '../../../src/puck/editor/ConfigureTestDrawer.js'
vi.mock('../../../src/puck/editor/ConfigureTestDrawer.js', async original => ({
  ...await original<typeof import('../../../src/puck/editor/ConfigureTestDrawer.js')>(),
  openConfigureTestDrawer: vi.fn(() => ({ close: vi.fn() })),
}))
const config: Config = { components: { ExperimentSlot: createExperimentSlotEditor({ routes: { api: '/host-api', admin: '/manage' } }), Text: { render: () => <p>Content</p> } } }
const block = { type: 'ExperimentSlot', props: { id: 'setup-block', experiment: null, control: [{ type: 'Text', props: { id: 'original' } }], variantA: [], variantB: [{ type: 'Text', props: { id: 'b' } }], variantC: [] } }
let read!: ReturnType<typeof useGetPuck>
let role: 'manager' | 'results' | 'none'
let failure: 'lookup' | 'post' | 'network' | 'malformed' | undefined
let taken: boolean
const reply = (body: unknown, status = 200) => Response.json(body, { status })
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  role = 'manager'; failure = undefined; taken = false
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.mocked(openConfigureTestDrawer).mockClear()
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'https://example.test')
    if (url.pathname.endsWith('/editor-surface')) return role === 'none' ? reply({}, 403) : reply({ canManage: role === 'manager', canReadResults: true })
    if (init?.method === 'POST') {
      if (failure === 'post') return reply({}, 403)
      if (failure === 'malformed') return reply({ doc: {} })
      return reply({ doc: { id: 'created', slug: 'landing-test' } })
    }
    if (url.searchParams.has('where[name][like]')) {
      if (failure === 'network') throw new Error('offline')
      return failure === 'lookup' ? reply({}, 403) : reply({ docs: taken ? [{ name: 'Landing test' }] : [] })
    }
    if (url.pathname.endsWith('/preflight')) return reply({ placements: [], checks: [] })
    if (url.pathname.endsWith('/created')) return reply({ name: 'Landing test', status: 'draft', arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 50 }, { key: 'variantB', kind: 'variant', label: 'Variant B', weight: 50 }] })
    return reply({ docs: [] })
  }))
})
afterEach(async () => { cleanup(); await act(async () => {}); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function mount(empty = false) {
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: { title: 'Landing' } }, content: empty ? [] : [block] }} iframe={{ enabled: false }}>
    <Puck.Preview /><aside data-testid="fields"><Puck.Fields /></aside><Probe />
  </Puck>)
  if (!empty) await screen.findByRole('button', { name: 'Set up test' })
}
const posts = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')

test.each([false, true])('one click creates populated versions, binds and opens Configure (taken name: %s)', async occupied => {
  taken = occupied
  await mount()
  expect(screen.getByText('This Experiment block has no test yet.')).toBeTruthy()
  expect(posts()).toHaveLength(0)
  const button = screen.getByRole('button', { name: 'Set up test' })
  fireEvent.click(button); fireEvent.click(button)
  await waitFor(() => expect(openConfigureTestDrawer).toHaveBeenCalledOnce())
  expect(posts()).toHaveLength(1)
  const payload = JSON.parse(String(posts()[0]![1]!.body))
  expect(payload.name).toBe(occupied ? 'Landing test 2' : 'Landing test')
  expect(payload.arms.map((arm: { key: string; weight: number }) => [arm.key, arm.weight])).toEqual([['control', 50], ['variantB', 50]])
  expect(read().getItemById('setup-block')?.props.experiment).toEqual({ id: 'created', slug: 'landing-test' })
  expect(openConfigureTestDrawer).toHaveBeenCalledWith(expect.any(HTMLElement), { api: '/host-api', admin: '/manage' }, 'created')
})

test('mount and insertion never create, and the sidebar offers existing-test selection', async () => {
  await mount(true)
  act(() => read().dispatch({ type: 'setData', data: { ...read().appState.data, content: [block] } }))
  await screen.findByRole('button', { name: 'Set up test' })
  act(() => read().dispatch({ type: 'setUi', ui: { itemSelector: read().getSelectorForId('setup-block')! } }))
  const fields = within(screen.getByTestId('fields'))
  fireEvent.click(await fields.findByRole('button', { name: 'Use an existing test' }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('combobox')
  expect(within(dialog).queryByRole('option', { name: 'No test' })).toBeNull()
  expect(posts()).toHaveLength(0)
})

test.each(['lookup', 'post', 'network', 'malformed'] as const)('creation failure %s leaves content and binding intact and can retry', async mode => {
  failure = mode
  await mount()
  const before = structuredClone(read().getItemById('setup-block'))
  fireEvent.click(screen.getByRole('button', { name: 'Set up test' }))
  expect((await screen.findByRole('alert')).textContent).toBe("Couldn't create the test. Try again.")
  expect(read().getItemById('setup-block')).toEqual(before)
  expect(openConfigureTestDrawer).not.toHaveBeenCalled()
  failure = undefined
  fireEvent.click(screen.getByRole('button', { name: 'Set up test' }))
  await waitFor(() => expect(openConfigureTestDrawer).toHaveBeenCalledOnce())
})

test.each(['results', 'none'] as const)('%s cannot create on an unbound block', async access => {
  role = access
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: {} }, content: [block] }} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
  await screen.findByText(access === 'results' ? "You don't have access to set up tests." : "You don't have access to tests.")
  expect(screen.queryByRole('button', { name: 'Set up test' })).toBeNull()
  expect(posts()).toHaveLength(0)
})

test.each(['removed', 'rebound'] as const)('created test recovery survives a block being %s during POST', async race => {
  const original = vi.mocked(fetch).getMockImplementation()!
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockImplementation((url, init) => init?.method === 'POST' ? new Promise(resolve => { finish = resolve }) : original(url, init))
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Set up test' }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  act(() => read().dispatch({ type: 'setData', data: { ...read().appState.data, content: race === 'removed' ? [] : [{ ...block, props: { ...block.props, experiment: { id: 'other', slug: 'other' } } }] } }))
  await act(async () => finish(reply({ doc: { id: 'created', slug: 'landing-test' } })))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('link', { name: 'Open the test' }).getAttribute('href')).toBe('/manage/experiments/created')
  expect(openConfigureTestDrawer).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})


test('a deleted binding is replaced in one click using only the block content', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((url, init) => String(url).includes('/deleted?') ? Promise.resolve(reply({}, 404)) : original(url, init))
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={{ root: { props: { title: 'Landing' } }, content: [{ ...block, props: { ...block.props, experiment: { id: 'deleted', slug: 'gone' } } }] }} iframe={{ enabled: false }}>
    <Puck.Preview /><Probe />
  </Puck>)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up test' }))
  await waitFor(() => expect(openConfigureTestDrawer).toHaveBeenCalledOnce())
  expect(JSON.parse(String(posts()[0]![1]!.body)).arms.map((arm: { key: string }) => arm.key)).toEqual(['control', 'variantB'])
  expect(read().getItemById('setup-block')?.props.experiment?.id).toBe('created')
})


test('selected setup failure has one alert in the sidebar and plain text in the header', async () => {
  failure = 'post'
  await mount()
  act(() => read().dispatch({ type: 'setUi', ui: { itemSelector: read().getSelectorForId('setup-block')! } }))
  const fields = within(screen.getByTestId('fields'))
  fireEvent.click(await fields.findByRole('button', { name: 'Set up test' }))
  const alert = await screen.findByRole('alert')
  expect(screen.getByTestId('fields').contains(alert)).toBe(true)
  expect(document.querySelector('.xp-slot-chrome')!.textContent).toContain("Couldn't create the test. Try again.")
  expect(document.querySelector('.xp-slot-chrome [role="alert"]')).toBeNull()
})

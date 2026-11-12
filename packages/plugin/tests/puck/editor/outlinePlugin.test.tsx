// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.hoisted(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
import { Puck, useGetPuck, type Config, type Data } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { experimentOutlinePlugin } from '../../../src/puck/editor/experimentOutlinePlugin.js'
import { setArms } from '../../../src/puck/editor/armsCache.js'

const doc = { name: 'Outline test', status: 'draft', arms: [
  { key: 'control', kind: 'control', label: 'Original' },
  { key: 'variantA', kind: 'variant', label: 'Variant A' },
] }
// Keep the shared document-read assertions independent of the optional placement read.
const experimentFetch = vi.fn<typeof fetch>()
const config: Config = { components: {
  ExperimentSlot: ExperimentSlotEditor,
  Text: { fields: { text: { type: 'text' } }, render: ({ text }) => <p>{text}</p> },
  Container: { fields: { children: { type: 'slot' } }, render: ({ children: Children }) => <Children /> },
  Legacy: { render: ({ puck }) => <>{puck.renderDropZone({ zone: 'legacy' })}</> },
} }
function block(id: string, testId: string | null = 'test', orphan = false) {
  return { type: 'ExperimentSlot', props: { id, experiment: testId ? { id: testId, slug: 'test' } : null,
    control: [], variantA: [], variantB: [],
    variantC: orphan ? [{ type: 'Text', props: { id: `${id}-text`, text: 'Orphan content' } }] : [],
  } }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  // jsdom lacks CSS.escape; use the CSSOM escape form for punctuation in these ids.
  vi.stubGlobal('CSS', { escape: vi.fn((value: string) => value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char.codePointAt(0)!.toString(16)} `)) })
  experimentFetch.mockReset().mockResolvedValue({ ok: true, json: async () => doc } as Response)
  vi.stubGlobal('fetch', vi.fn((...args: Parameters<typeof fetch>) => String(args[0]).endsWith('/xp/editor-surface')
    ? Promise.resolve(new Response(JSON.stringify({ canManage: true, canReadResults: true }))) : String(args[0]).endsWith('/preflight')
    ? Promise.resolve(new Response(JSON.stringify({ placements: [] }))) : experimentFetch(...args)))
  for (const id of ['test', 'unknown', 'failed']) setArms(id, undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function mount(data: Data, preview = false) {
  return render(<Puck config={config} data={data} plugins={[experimentOutlinePlugin(), {
    overrides: { outline: ({ children }) => <div data-testid="other-plugin">{children}</div> },
  }]} overrides={{ outline: ({ children }) => <aside data-testid="host-outline">{children}</aside> }}
    iframe={{ enabled: false }} ui={{ itemExpanded: Object.fromEntries(['two-arm', 'orphan', 'unbound', 'pending', 'nested', 'container', 'legacy', 'zoned', 'escaped"id'].map(id => [id, true])) }}>
    <Puck.Outline />{preview ? <Puck.Preview /> : null}
  </Puck>)
}

function rows(id: string) {
  const item = [...document.querySelectorAll('li[data-puck-layer-tree-id]')].find(row => row.getAttribute('data-puck-layer-tree-id') === id)
  expect(item, `Puck outline item attribute changed: ${id}`).toBeTruthy()
  const zones = [...item!.children].filter(child => child.matches('div[class*="Layer-zones"]'))
  expect(zones.map(zone => within(zone as HTMLElement).getAllByText(/^(Original|Variant [ABC])$/)[0]!.textContent), 'Puck zone containers/order changed').toEqual(['Original', 'Variant A', 'Variant B', 'Variant C'])
  return zones
}
function visibility(id: string) {
  // jsdom evaluates these sibling selectors and display:none. There is no layout
  // dependency: assert computed display on the real zone containers, not a mock tree.
  return rows(id).map(row => getComputedStyle(row).display !== 'none')
}

test('real outline hides only absent empty slots; orphan, unknown and Original remain visible; host overrides compose', () => {
  setArms('test', ['control', 'variantA'])
  mount({ root: { props: {} }, content: [block('two-arm'), block('orphan', 'test', true), block('unbound', null), block('pending', 'unknown')] })
  expect(screen.getByTestId('host-outline').querySelector('li')).toBeTruthy()
  expect(screen.getByTestId('other-plugin').contains(screen.getByTestId('host-outline'))).toBe(true)
  expect(visibility('two-arm')).toEqual([true, true, false, false])
  expect(visibility('orphan')).toEqual([true, true, false, true])
  expect(visibility('unbound')).toEqual([true, false, false, false])
  expect(visibility('pending')).toEqual([true, true, true, true])
  // A DropLine can precede the inner row while dragging; it must never shift zone indexes.
  const row = rows('two-arm')[0]!.parentElement!
  row.prepend(document.createElement('div'))
  expect(visibility('two-arm')).toEqual([true, true, false, false])
  for (const style of document.querySelectorAll('style[data-xp-outline]')) {
    const declarations = [...style.textContent!.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!.trim())
    expect(declarations.every(value => value === 'display: none;')).toBe(true)
    expect(style.textContent).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(|(?:color|background)\s*:/i)
  }
})

test('walks nested slots and legacy zones and escapes item ids', () => {
  setArms('test', ['control', 'variantA'])
  mount({ root: { props: {} }, content: [
    { type: 'Container', props: { id: 'container', children: [block('nested')] } },
    { type: 'Legacy', props: { id: 'legacy' } }, block('escaped"id'),
  ], zones: { 'legacy:legacy': [block('zoned')] } })
  for (const id of ['nested', 'zoned', 'escaped"id']) expect(visibility(id)).toEqual([true, true, false, false])
  expect(CSS.escape).toHaveBeenCalledWith('escaped"id')
})

test('editor fetch fills cache, tab-return refetch updates it, warning uses static label, and saved page data stays unchanged', async () => {
  const data: Data = { root: { props: {} }, content: [block('orphan', 'test', true)], zones: {} }
  const before = structuredClone(data)
  let saved: Data | undefined
  function Save() {
    const getPuck = useGetPuck()
    return <button onClick={() => { saved = getPuck().appState.data }}>Save page</button>
  }
  const changed = vi.fn()
  // Save reads Puck's public page state, just as the host does; loading must not dispatch props.
  render(<Puck config={config} data={data} plugins={[experimentOutlinePlugin()]} onChange={changed}
    iframe={{ enabled: false }} ui={{ itemExpanded: { orphan: true } }}>
    <Puck.Outline /><Puck.Preview /><Save />
  </Puck>)
  await screen.findByText("Variant C has content but isn't part of this test. Move or delete it; visitors never see it.")
  expect(visibility('orphan')).toEqual([true, true, false, true])
  expect(screen.getByText(/Variant C has content/).closest('.xp-ui-banner--warning')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save page' }))
  expect(saved).toEqual(before)
  expect(data).toEqual(before)
  experimentFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...doc, arms: [doc.arms[0],
    { key: 'variantB', kind: 'variant', label: 'New B' }, { key: 'variantC', kind: 'variant', label: 'Custom name' },
  ] }) } as Response)
  returnToTab()
  // A becoming hidden proves the refetch response has repopulated the cache.
  await waitFor(() => expect(visibility('orphan')).toEqual([true, false, true, true]))
  expect(screen.queryByText(/Variant C has content/)).toBeNull()
  expect(experimentFetch).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'Save page' }))
  expect(saved).toEqual(before)
  expect(changed).not.toHaveBeenCalled()
  expect(data).toEqual(before)
  act(() => setArms('test', ['control']))
  expect(visibility('orphan')).toEqual([true, false, false, true])
})

test('bound loading and failed fetch keep every zone visible, even with a previously cached document', async () => {
  setArms('failed', ['control', 'variantA'])
  let fail!: (reason: Error) => void
  experimentFetch.mockReturnValue(new Promise((_, reject) => { fail = reject }))
  mount({ root: { props: {} }, content: [block('pending', 'failed')] }, true)
  expect(visibility('pending')).toEqual([true, true, true, true])
  await act(async () => { fail(new Error('offline')) })
  await screen.findByText("Couldn't load this test. Try selecting it again.")
  expect(visibility('pending')).toEqual([true, true, true, true])
})

function returnToTab() {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
}

test('visibility return refetches once for two blocks on the same test; focus and hidden do not refetch; unmount removes listeners', async () => {
  const view = mount({ root: { props: {} }, content: [block('two-arm'), block('orphan')] }, true)
  await waitFor(() => expect(visibility('two-arm')).toEqual([true, true, false, false]))
  expect(experimentFetch).toHaveBeenCalledTimes(1)
  fireEvent(window, new Event('focus'))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  fireEvent(document, new Event('visibilitychange'))
  expect(experimentFetch).toHaveBeenCalledTimes(1)
  returnToTab()
  await waitFor(() => expect(experimentFetch).toHaveBeenCalledTimes(2))
  await act(async () => {})
  expect(visibility('orphan')).toEqual([true, true, false, false])
  view.unmount()
  returnToTab()
  expect(experimentFetch).toHaveBeenCalledTimes(2)
})

test('during a refetch hidden rows stay hidden without flicker and the orphan warning stays visible', async () => {
  mount({ root: { props: {} }, content: [block('orphan', 'test', true)] }, true)
  await screen.findByText(/Variant C has content/)
  let finish!: (response: Response) => void
  experimentFetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  returnToTab()
  expect(experimentFetch).toHaveBeenCalledTimes(2)
  expect(visibility('orphan')).toEqual([true, true, false, true])
  expect(screen.getByText(/Variant C has content/)).toBeTruthy()
  await act(async () => { finish({ ok: true, json: async () => doc } as Response) })
  expect(visibility('orphan')).toEqual([true, true, false, true])
})

test.each([false, true])('a second block joins known arms and the pending fetch; the next editor clears stale arms (orphan: %s)', async orphan => {
  function AddBlock() {
    const getPuck = useGetPuck()
    return <button onClick={() => {
      const { appState, dispatch } = getPuck()
      dispatch({ type: 'setData', data: { ...appState.data, content: [...appState.data.content, block('orphan')] } })
    }}>Add block</button>
  }
  const view = render(<Puck config={config} data={{ root: { props: {} }, content: [block('two-arm', 'test', orphan)] }}
    plugins={[experimentOutlinePlugin()]} iframe={{ enabled: false }} ui={{ itemExpanded: { 'two-arm': true, orphan: true } }}>
    <Puck.Outline /><Puck.Preview /><AddBlock />
  </Puck>)
  const knownVisibility = [true, true, false, orphan]
  await waitFor(() => expect(visibility('two-arm')).toEqual(knownVisibility))
  expect(experimentFetch).toHaveBeenCalledTimes(1)
  let finish!: (response: Response) => void
  experimentFetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  returnToTab()
  expect(experimentFetch).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'Add block' }))
  await waitFor(() => expect(document.querySelectorAll('.xp-slot-editor')).toHaveLength(2))
  expect(visibility('two-arm')).toEqual(knownVisibility)
  expect(visibility('orphan')).toEqual([true, true, false, false])
  expect(Boolean(screen.queryByText(/Variant C has content/))).toBe(orphan)
  expect(experimentFetch).toHaveBeenCalledTimes(2)
  await act(async () => { finish({ ok: true, json: async () => doc } as Response) })
  view.unmount()

  // No mounted consumer remains: a fresh editor must not trust the old document.
  experimentFetch.mockReturnValueOnce(new Promise(() => {}))
  mount({ root: { props: {} }, content: [block('two-arm')] }, true)
  expect(visibility('two-arm')).toEqual([true, true, true, true])
  expect(experimentFetch).toHaveBeenCalledTimes(3)
})

test('a failed refetch clears known arms to unknown', async () => {
  mount({ root: { props: {} }, content: [block('two-arm')] }, true)
  await waitFor(() => expect(visibility('two-arm')).toEqual([true, true, false, false]))
  experimentFetch.mockRejectedValueOnce(new Error('offline'))
  returnToTab()
  await screen.findByText("Couldn't load this test. Try selecting it again.")
  expect(visibility('two-arm')).toEqual([true, true, true, true])
})

test('SSR of the real outline with an unbound block needs no CSS browser global', () => {
  vi.stubGlobal('CSS', undefined)
  let html = ''
  expect(() => { html = renderToString(<Puck config={config} data={{ root: { props: {} }, content: [block('unbound', null)] }}
    plugins={[experimentOutlinePlugin()]} iframe={{ enabled: false }}><Puck.Outline /></Puck>) }).not.toThrow()
  expect(html).not.toContain('data-xp-outline')
})

test('typing in an unrelated field does not regenerate rules and preserves the style without mutations', () => {
  setArms('test', ['control', 'variantA'])
  function UnrelatedField() {
    const getPuck = useGetPuck()
    return <input aria-label="Unrelated field" onChange={event => {
      const { appState, dispatch } = getPuck()
      dispatch({ type: 'setData', data: { ...appState.data, root: { props: { title: event.target.value } } } })
    }} />
  }
  render(<Puck config={config} data={{ root: { props: {} }, content: [block('two-arm')] }}
    plugins={[experimentOutlinePlugin()]} iframe={{ enabled: false }} ui={{ itemExpanded: { 'two-arm': true } }}>
    <Puck.Outline /><UnrelatedField />
  </Puck>)
  const style = document.querySelector('style[data-xp-outline="two-arm"]')!
  const text = style.textContent
  expect(text).toContain('display: none')
  const observer = new MutationObserver(() => {})
  observer.observe(style.parentNode!, { childList: true, subtree: true, characterData: true })
  const escapes = vi.mocked(CSS.escape).mock.calls.length
  expect(escapes).toBeGreaterThan(0)
  for (const value of ['H', 'He', 'Hello']) fireEvent.change(screen.getByLabelText('Unrelated field'), { target: { value } })
  expect(CSS.escape).toHaveBeenCalledTimes(escapes)
  expect(document.querySelector('style[data-xp-outline="two-arm"]')).toBe(style)
  expect(style.textContent).toBe(text)
  expect(observer.takeRecords().filter(record => record.target === style || style.contains(record.target))).toEqual([])
  observer.disconnect()
})

test('30 root items use real Puck virtualized Layer markup and hide absent empty version rows', async () => {
  // jsdom has no layout; provide scroll geometry so TanStack can mount the real virtual rows.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, bottom: 800, right: 800, width: 800, height: 800, toJSON() {},
  })
  setArms('test', ['control', 'variantA'])
  const content = [block('two-arm'), ...Array.from({ length: 29 }, (_, index) => ({ type: 'Text', props: { id: `text-${index}`, text: `Item ${index}` } }))]
  render(<div style={{ overflow: 'auto', height: 800 }}><Puck config={config} data={{ root: { props: {} }, content }}
    plugins={[experimentOutlinePlugin()]} iframe={{ enabled: false }} ui={{ itemExpanded: { 'two-arm': true } }}>
    <Puck.Outline />
  </Puck></div>)
  await waitFor(() => expect(document.querySelector('li[data-puck-layer-tree-id="two-arm"][data-index="0"]')).toBeTruthy())
  expect(visibility('two-arm')).toEqual([true, true, false, false])
})

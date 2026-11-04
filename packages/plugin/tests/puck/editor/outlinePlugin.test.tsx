// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => doc }))
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

test('editor fetch fills cache, focus refetch updates it, warning uses static label, and saved page data stays unchanged', async () => {
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
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...doc, arms: [doc.arms[0],
    { key: 'variantB', kind: 'variant', label: 'New B' }, { key: 'variantC', kind: 'variant', label: 'Custom name' },
  ] }) } as Response)
  fireEvent(window, new Event('focus'))
  // Unknown during loading also reveals B/C and removes the warning; A becoming
  // hidden proves that the refetch response has actually repopulated the cache.
  await waitFor(() => expect(visibility('orphan')).toEqual([true, false, true, true]))
  expect(screen.queryByText(/Variant C has content/)).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(2)
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
  vi.mocked(fetch).mockReturnValue(new Promise((_, reject) => { fail = reject }))
  mount({ root: { props: {} }, content: [block('pending', 'failed')] }, true)
  expect(visibility('pending')).toEqual([true, true, true, true])
  await act(async () => { fail(new Error('offline')) })
  await screen.findByText("Couldn't load this test. Try selecting it again.")
  expect(visibility('pending')).toEqual([true, true, true, true])
})

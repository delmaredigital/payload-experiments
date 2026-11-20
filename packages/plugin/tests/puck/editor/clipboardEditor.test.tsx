// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, useGetPuck, type ComponentData, type Config, type Data } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { editorCopy } from '../../../src/puck/editor/copy.js'

// The public /editor entry exports hook types, not clipboard operations. Exercise
// the installed operation used by its action bar and keyboard, with a real Puck API.
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
function mount(data: Data) {
  function Probe() { getPuck = useGetPuck(); return null }
  render(<Puck config={config} data={data} iframe={{ enabled: false }}><Puck.Preview /><Probe /></Puck>)
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
test('real paste path permits ordinary content inside an Experiment version', async () => {
  mount({ root: { props: {} }, content: [experiment('outer')] })
  const clipboard = await copied(container('copy-container', [{ type: 'Text', props: { id: 'text', text: 'Content' } }]))
  act(() => { expect(pasteBlock(getPuck(), 'outer:control', 0, clipboard)).toBe(true) })
  await waitFor(() => expect(getPuck().getItemById('outer')!.props.control).toHaveLength(1))
  const pasted = getPuck().getItemById('outer')!.props.control[0]
  expect(pasted.type).toBe('Container')
  expect(pasted.props.children[0].props.text).toBe('Content')
})

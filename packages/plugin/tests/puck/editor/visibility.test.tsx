// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
import { Puck, useGetPuck, type Config, type Data } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { editorCopy as C } from '../../../src/puck/editor/copy.js'

const block = { type: 'ExperimentSlot', props: { id: 'hidden-test-block', experiment: { id: 'visibility-test', slug: 'hero' }, control: [], variantA: [], variantB: [], variantC: [] } }
const config: Config = { components: { ExperimentSlot: ExperimentSlotEditor,
  Container: { fields: { children: { type: 'slot' } }, render: ({ children: Children }) => <Children /> },
  Legacy: { render: ({ puck }) => <>{puck.renderDropZone({ zone: 'children' })}</> },
} }
let read!: ReturnType<typeof useGetPuck>
let placements: unknown[]
let checks: unknown[]
beforeEach(() => {
  placements = []; checks = []
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  window.history.replaceState({}, '', '/admin/puck-editor/pages/one')
})
afterEach(async () => { cleanup(); await act(async () => {}); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })
async function mount(status: string, data: Data, decision: { winnerArm?: string; discardedAt?: string } | null = { winnerArm: 'variantA' }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/editor-surface') ? { canManage: true, canReadResults: true }
    : url.endsWith('/preflight') ? { checks, placements } : url.endsWith('/results') || url.includes('/summary?') ? {} : {
      name: 'Visibility test', status, decision, arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 50 }, { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50 }],
    })))
  function Probe() { read = useGetPuck(); return null }
  render(<Puck config={config} data={data} iframe={{ enabled: false }}><Puck.Preview /><aside data-testid="fields"><Puck.Fields /></aside><Probe /></Puck>)
  await screen.findByRole('heading', { name: 'Visibility test' })
  act(() => read().dispatch({ type: 'setUi', ui: { itemSelector: read().getSelectorForId(block.props.id)! } }))
  await within(screen.getByTestId('fields')).findByRole('region', { name: C.testGroup })
}
const chrome = () => within(document.querySelector<HTMLElement>('.xp-slot-chrome')!)
const sidebar = () => within(screen.getByTestId('fields'))
test.each(['draft', 'running', 'stopped', 'decided', 'archived'])('fully hidden %s block replaces save/publish guidance in both surfaces', async status => {
  await mount(status, { root: { props: {} }, content: [{ ...block, props: { ...block.props, _visibility: { hidden: true } } }] })
  expect(chrome().getAllByText(C.hidden)).toHaveLength(1)
  expect(sidebar().getAllByText(C.hidden)).toHaveLength(1)
  expect(screen.queryByText(/Save this page|Publish this page|Save or publish/)).toBeNull()
})
test.each(['slot', 'zone'] as const)('an ancestor hidden through a %s supplies the block notice', async mode => {
  await mount('draft', { root: { props: {} }, content: [{ type: mode === 'slot' ? 'Container' : 'Legacy', props: {
    id: 'parent', _visibility: { hidden: true }, ...(mode === 'slot' ? { children: [block] } : {}),
  } }], zones: mode === 'zone' ? { 'parent:children': [block] } : undefined })
  expect(chrome().getByText(C.hidden)).toBeTruthy()
  expect(sidebar().getByText(C.hidden)).toBeTruthy()
})
test.each([{ sizes: ['phone'] }, { sizes: ['phone', 'tablet'] }])('partial hiding on $sizes has a neutral note and retains placement guidance', async ({ sizes }) => {
  placements = [{ collection: 'pages', id: 'elsewhere', detail: 'Published' }]
  await mount('draft', { root: { props: {} }, content: [{ ...block, props: { ...block.props, _visibility: { hideOn: sizes } } }] })
  const sentence = C.hiddenOn(sizes.join(' and '))
  expect(chrome().getByText(sentence).closest('.xp-ui-banner')?.className).toContain('info')
  expect(sidebar().getByText(sentence)).toBeTruthy()
  // This visible local block is unsaved: ordinary save guidance still applies.
  expect(chrome().queryByText(C.hidden)).toBeNull()
})
test('a hidden block itself adds no Start blocker when another published place exists', async () => {
  placements = [{ collection: 'pages', id: 'elsewhere', detail: 'Published' }]
  await mount('draft', { root: { props: {} }, content: [{ ...block, props: { ...block.props, _visibility: { hidden: true } } }] })
  await waitFor(() => expect(sidebar().getByRole('button', { name: 'Start' })).toBeTruthy())
})
test('without a published place the existing missing-placement blocker remains', async () => {
  checks = [{ code: 'no-placements', ok: false }]
  await mount('draft', { root: { props: {} }, content: [{ ...block, props: { ...block.props, _visibility: { hidden: true } } }] })
  expect(await sidebar().findByText('Not on a page yet. Open a page, add an Experiment block and choose this test.')).toBeTruthy()
  expect(sidebar().queryByRole('button', { name: 'Start' })).toBeNull()
})


test.each(['decided', 'archived'])('un-hiding a retained %s block restores its normal editor state', async status => {
  await mount(status, { root: { props: {} }, content: [{ ...block, props: { ...block.props, _visibility: { hidden: true } } }] })
  expect(chrome().getByText(C.hidden)).toBeTruthy()
  const item = read().getItemById(block.props.id)!
  const selector = read().getSelectorForId(item.props.id)!
  act(() => read().dispatch({ type: 'replace', destinationIndex: selector.index, destinationZone: selector.zone, data: { ...item, props: { ...item.props, _visibility: {} } } }))
  await waitFor(() => expect(chrome().queryByText(C.hidden)).toBeNull())
  expect(sidebar().queryByText(C.hidden)).toBeNull()
  expect(sidebar().getByText(status === 'decided' ? C.decided('Variant A') : C.archived('Variant A'))).toBeTruthy()
  expect(screen.getByRole('tab', { name: 'Variant A' })).toBeTruthy()
  expect(sidebar().getByRole('button', { name: 'Configure test' })).toBeTruthy()
  expect(sidebar().queryByRole('button', { name: 'Start' })).toBeNull()
  expect(sidebar().queryByRole('alert')).toBeNull()
  expect(screen.queryByText(/Save this page|Publish this page/)).toBeNull()
})

test.each([null, { winnerArm: 'variantA', discardedAt: 'date' }])('archived Puck notice gives available manual steps for %j', async decision => {
  await mount('archived', { root: { props: {} }, content: [block] }, decision)
  expect(sidebar().getByText(C.archivedOriginal('Original', Boolean(decision?.discardedAt)))).toBeTruthy()
  expect(sidebar().queryByText(/Use.*Make it the content/)).toBeNull()
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { DocumentViewClientProps } from 'payload'
import type { ResultsResponse } from '../../../src/types/endpoints.js'
import type { Snapshot } from '../../../src/types/snapshot.js'
import { ResultsView } from '../../../src/admin/results/ResultsView.js'
import { RESULTS_COPY } from '../../../src/admin/copy/results.js'
import { fixture, phaseFor } from './fixtures.js'
import { resetPayloadUiMock, setAuth, setDocumentInfo, setFormFields } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals() })
const props = { documentSubViewType: 'default', formState: {}, viewType: 'document' } satisfies DocumentViewClientProps
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const preflight = { checks: [], placements: [{ collection: 'pages', id: 'home', title: 'Home', url: '/home', ok: true }], baseline: null, trafficPerDay: null, estimate: null }
function document(data: Record<string, unknown> = { status: 'running' }, manage = false) {
  setDocumentInfo({ id: 'xp/one', collectionSlug: 'xp-experiments', data })
  setAuth({ permissions: { collections: { 'xp-experiments': { update: { permission: manage } } } } })
  setFormFields({ status: { value: data.status }, kind: { value: 'block' },
    'arms.0.key': { value: 'control' }, 'arms.0.kind': { value: 'control' },
    'arms.1.key': { value: 'variantA' }, 'arms.1.kind': { value: 'variant' } })
}
function response(snapshot: Snapshot = fixture('T7')): ResultsResponse {
  return { phases: [phaseFor(snapshot)], snapshot, series: [] }
}
function fetchResults(data: ResultsResponse) {
  const fetcher = vi.fn(async (url: string) => json(url.endsWith('/preflight') ? preflight : data))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

test('loading state while discovering rounds', () => {
  document()
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  render(<ResultsView {...props} />)
  expect(screen.getByRole('status').textContent).toBe('Loading results…')
})
test('403 gives the results-specific access message', async () => {
  document()
  const fetcher = vi.fn().mockResolvedValue(json({}, 403))
  vi.stubGlobal('fetch', fetcher)
  render(<ResultsView {...props} />)
  expect((await screen.findByRole('alert')).textContent).toBe("You don't have access to results.")
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
})
test.each([false, true])('empty state for no rounds or a null snapshot (has round: %s)', async hasRound => {
  document()
  fetchResults({ phases: hasRound ? [phaseFor(fixture('T7'))] : [], snapshot: null })
  render(<ResultsView {...props} />)
  expect(await screen.findByText('No results yet — the first results appear within the hour after Start.')).toBeTruthy()
})
test('server error displays its message and Retry refetches results', async () => {
  document()
  const fetcher = vi.fn().mockResolvedValueOnce(json({ errors: [{ message: 'Results are being repaired.' }] }, 500))
    .mockImplementation(async () => json(response()))
  vi.stubGlobal('fetch', fetcher)
  render(<ResultsView {...props} />)
  expect(await screen.findByText('Results are being repaired.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('table', { name: 'Registrations' })
  expect(fetcher).toHaveBeenCalledTimes(3) // refused discovery, retry discovery, selected round
})
test('decided defaults to the decision round and renders the decision-time finding without its action', async () => {
  const decisionSnapshot = fixture('T5'), snapshot = fixture('T7'), rollout = fixture('R3')
  rollout.phase = 2
  const phases = [phaseFor(snapshot), phaseFor(rollout)]
  document({ status: 'decided', decision: { phase: 1, winnerArm: 'variantA', decidedBy: 'opaque-editor' } })
  const fetcher = vi.fn(async (url: string) => json({ phases, snapshot: url.includes('phase=1') ? snapshot : rollout, decisionSnapshot }))
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<ResultsView {...props} />)
  await screen.findByRole('heading', { name: 'Decided: Shorter form' })
  expect((screen.getByRole('combobox', { name: 'Round' }) as HTMLSelectElement).value).toBe('1')
  expect(screen.getByText(decisionSnapshot.verdict.finding)).toBeTruthy()
  if (decisionSnapshot.verdict.action) expect(container.textContent).not.toContain(decisionSnapshot.verdict.action)
  expect(container.textContent).not.toContain('Keep running')
  expect(container.innerHTML).not.toContain('opaque-editor')
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/xp/experiments/xp%2Fone/results?series=1', '/api/xp/experiments/xp%2Fone/results?phase=1&series=1',
  ])
})
test('selecting rounds refetches; late data from a previous selection cannot overwrite the current round', async () => {
  document()
  const old = fixture('T4'), newest = fixture('T7')
  newest.phase = 2
  const phases = [phaseFor(old), phaseFor(newest)]
  let resolveOld!: (response: Response) => void
  const fetcher = vi.fn((url: string) => url.includes('phase=1')
    ? new Promise<Response>(resolve => { resolveOld = resolve })
    : Promise.resolve(json({ phases, snapshot: newest })))
  vi.stubGlobal('fetch', fetcher)
  render(<ResultsView {...props} />)
  await screen.findByRole('heading', { name: newest.verdict.headline })
  const selector = screen.getByRole('combobox', { name: 'Round' })
  expect((selector as HTMLSelectElement).value).toBe('2')
  fireEvent.change(selector, { target: { value: '1' } })
  expect(screen.getByRole('status').textContent).toBe(RESULTS_COPY.loading)
  expect(screen.queryByRole('heading', { name: newest.verdict.headline })).toBeNull()
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
  fireEvent.change(selector, { target: { value: '2' } })
  await screen.findByRole('heading', { name: newest.verdict.headline })
  await act(async () => { resolveOld(json({ phases, snapshot: old })) })
  expect(screen.queryByRole('heading', { name: old.verdict.headline })).toBeNull()
  expect(screen.getByRole('heading', { name: newest.verdict.headline })).toBeTruthy()
  expect(fetcher.mock.calls.filter(([url]) => url.includes('phase=2'))).toHaveLength(2)
})
test('older rounds never show a running power line; live minimum exposures never fill the frozen round', async () => {
  document({ status: 'running', minExposuresPerArm: 98765, analysis: { minExposuresPerArm: 98765 } })
  const old = fixture('T4'), newest = fixture('T4')
  old.power.daysRemaining = 0
  newest.phase = 2
  const phases = [phaseFor(old), phaseFor(newest)]
  const fetcher = vi.fn(async (url: string) => json({ phases, snapshot: url.includes('phase=1') ? old : newest }))
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<ResultsView {...props} />)
  await screen.findByText('About 42 more days.')
  expect(screen.getByText('360 of — people, 37 of 150 conversions')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Round' }), { target: { value: '1' } })
  await screen.findByText('360 of — people, 37 of 150 conversions')
  expect(container.querySelector('.xp-power')).toBeNull()
  expect(container.textContent).not.toContain('Keep running')
  expect(container.textContent).not.toContain('98,765')
})
test('renders primary, supporting and guardrails in order and composes the primary chart', async () => {
  document()
  const snapshot = fixture('T7')
  const supporting = { ...snapshot.metrics[0]!, metricId: 'support', name: 'Supporting outcome', role: 'secondary' as const }
  snapshot.metrics = [snapshot.metrics[1]!, supporting, snapshot.metrics[0]!]
  const data = response(snapshot)
  data.series = ['2026-10-29', '2026-10-30'].map(computedAt => ({ computedAt, metricId: 'registrations', arm: 'variantA', lift: 0.1, ci: [0, 0.2] }))
  fetchResults(data)
  render(<ResultsView {...props} />)
  await screen.findByRole('table', { name: 'Registrations' })
  expect(screen.getAllByRole('table').map(table => table.querySelector('caption')!.textContent)).toEqual(['Registrations', 'Supporting outcome', 'Completed lessons'])
  expect(screen.getByRole('heading', { name: 'Supporting (not used for the decision)' })).toBeTruthy()
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Registrations: lift')
})
test('Recompute posts once during rapid clicks and refetches the selected round', async () => {
  document({ status: 'running' }, true)
  let finish!: (response: Response) => void
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Promise<Response>(resolve => { finish = resolve })
    return Promise.resolve(json(url.endsWith('/preflight') ? preflight : response()))
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ResultsView {...props} />)
  await screen.findByRole('table', { name: 'Registrations' })
  const button = screen.getByRole('button', { name: 'Recompute' })
  act(() => { button.click(); button.click() })
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  expect((screen.getByRole('button', { name: 'Recomputing…' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { finish(json({ snapshotId: 'updated' })) })
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.includes('phase=1'))).toHaveLength(2))
  expect(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')?.[0]).toBe('/api/xp/experiments/xp%2Fone/recompute')
})
test.each([false, true])('preview placements are fetched and links and Recompute appear only for managers (%s)', async manage => {
  document({ status: 'running' }, manage)
  const fetcher = fetchResults(response())
  render(<ResultsView {...props} />)
  await screen.findByRole('table', { name: 'Registrations' })
  if (manage) {
    await screen.findByRole('button', { name: 'Preview Shorter form' })
    expect(screen.getByRole('button', { name: 'Recompute' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  } else {
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Recompute' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  }
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/preflight'))).toHaveLength(manage ? 1 : 0)
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { ResultsBody } from '../../../../src/admin/surface/results/ResultsBody.js'
import * as resultsHook from '../../../../src/admin/surface/results/useResults.js'
import { reloadPage } from '../../../../src/admin/reload.js'
import type { SurfaceProps } from '../../../../src/admin/surface/contracts.js'
import { fixture, phaseFor, revenueSnapshot } from '../../results/fixtures.js'
import type { ResultsResponse } from '../../../../src/types/endpoints.js'
vi.mock('@payloadcms/ui', async () => (await import('../../_helpers/payloadUiMock.js')).payloadUiMock())
vi.mock('../../../../src/admin/reload.js', () => ({ reloadPage: vi.fn() }))
const surface: SurfaceProps = { adminRoute: '/admin', apiRoute: '/api', canManage: true, canReadResults: true, isAdmin: false, flagPoints: [], attributeKeys: {}, metricSources: [] }
const snapshot = fixture('T7')
const phase = phaseFor(snapshot)
const response: ResultsResponse = { experiment: { name: 'Signup form', kind: 'flag', status: 'running' }, phases: [phase], snapshot, series: ['2026-10-29', '2026-10-30'].map(computedAt => ({ computedAt, metricId: 'registrations', arm: 'variantA', lift: 0.1, ci: [0, 0.2] })) }
const doc = { status: 'running', arms: phase.arms.map(arm => ({ ...arm, label: `Current ${arm.key}` })), analysis: { plannedDurationDays: 28 } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function setup(data: ResultsResponse = response, saved = doc) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return json({ snapshotId: 'updated' })
    if (url.includes('/xp-experiments/')) return json(saved)
    if (url.endsWith('/preflight')) return json({ placements: [{ collection: 'pages', id: 'page', title: 'Landing page', url: '/preview' }] })
    if (url.includes('preview-token')) return json({ token: 'preview-token' })
    return json(data)
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })
test('a missing selected round shows round-picker copy and keeps the picker available', async () => {
  const newer = { ...snapshot, phase: 2 }
  const fetcher = setup({ phases: [phase, phaseFor(newer)], snapshot: newer })
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation((url, init) => url.includes('phase=1')
    ? Promise.resolve(json({ errors: [{ code: 'not-found', message: 'Round not found' }] }, 404))
    : original(url, init))
  render(<ResultsBody id={1} surface={surface} />)
  await screen.findByText('Shorter form is most likely to be best.')
  fireEvent.change(screen.getByRole('combobox', { name: 'Round' }), { target: { value: '1' } })
  expect((await screen.findByRole('alert')).textContent).toBe('That round no longer exists. Choose another round.')
  expect(fetcher.mock.calls.some(([url]) => url === '/api/xp/experiments/1/results?phase=1&series=1')).toBe(true)
  expect(screen.getByRole('combobox', { name: 'Round' })).toBeTruthy()
  expect(screen.queryByText('Round not found')).toBeNull()
})

test.each(['running', 'stopped'])('collecting results show the stored detail without duplicate counts when %s', async status => {
  const collecting = fixture(status === 'running' ? 'T4' : 'T4-stopped')
  setup({ experiment: response.experiment, phases: [phaseFor(collecting)], snapshot: collecting }, { ...doc, status })
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  expect(await screen.findByText(collecting.verdict.detail)).toBeTruthy()
  expect(container.querySelector('.xp-collecting')).toBeNull()
  expect(container.textContent).not.toContain('360 of 1,000 people, 37 of 150 conversions')
})
test('composes verdict headline, recommendation, tables, chart, data quality, round and previews', async () => {
  setup({ ...response, snapshot: { ...snapshot, exposures: { ...snapshot.exposures, armMismatch: 1 } } })
  const { container } = render(<ResultsBody id="xp/one" surface={surface} />)
  const sentence = await screen.findByText('Shorter form is most likely to be best.')
  const heading = screen.getByRole('heading', { name: snapshot.verdict.headline })
  expect(heading.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Registrations' })).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Completed lessons' })).toBeTruthy()
  expect(screen.getByText('Data quality')).toBeTruthy()
  fireEvent.click(screen.getByText('Confidence interval over time'))
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Registrations')
  expect(screen.getByRole('combobox', { name: 'Round' })).toBeTruthy()
  expect(await screen.findByRole('button', { name: 'Preview Current variantA' })).toBeTruthy()
  expect(container.querySelector('form')).toBeNull()
})
test.each([true, false])('actions and preflight are gated by manage: %s', async canManage => {
  const fetcher = setup()
  if (!canManage) {
    const original = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, init) => url.includes('/xp-experiments/') ? Promise.resolve(json({}, 403)) : original(url, init))
  }
  render(<ResultsBody id={1} surface={{ ...surface, canManage }} />)
  await screen.findByText('Shorter form is most likely to be best.')
  expect(Boolean(screen.queryByRole('button', { name: 'Recompute' }))).toBe(canManage)
  expect(Boolean(screen.queryByRole('button', { name: 'Decide' }))).toBe(canManage)
  expect(screen.queryAllByRole('button', { name: /Preview/ }).length > 0).toBe(canManage)
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/preflight'))).toHaveLength(canManage ? 1 : 0)
})
test('Recompute posts once during rapid clicks and refreshes the selected round', async () => {
  const fetcher = setup()
  let finish!: (response: Response) => void
  fetcher.mockImplementation(async (url, init) => {
    if (init?.method === 'POST') return new Promise(resolve => { finish = resolve })
    if (url.includes('/xp-experiments/')) return json(doc)
    if (url.endsWith('/preflight')) return json({ placements: [] })
    return json(response)
  })
  render(<ResultsBody id={1} surface={surface} />)
  await screen.findByText('Shorter form is most likely to be best.')
  const button = screen.getByRole('button', { name: 'Recompute' })
  act(() => { button.click(); button.click() })
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  await act(async () => { finish(json({ snapshotId: 'updated' })) })
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.includes('phase=1'))).toHaveLength(1))
})
test('Decide opens the shared dialog with newest round labels, posts once, and reloads the page on success', async () => {
  const newest = { ...snapshot, phase: 2 }
  const newestPhase = phaseFor(newest)
  newestPhase.arms.find(arm => arm.key === 'variantA')!.label = 'Newest shorter form'
  const fetcher = setup({ experiment: response.experiment, phases: [phase, newestPhase], snapshot: newest })
  let finish!: (response: Response) => void
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation((url, init) => init?.method === 'POST' ? new Promise(resolve => { finish = resolve }) : original(url, init))
  render(<ResultsBody id={1} surface={surface} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Decide' }))
  const dialog = screen.getByRole('dialog')
  await waitFor(() => expect((within(dialog).getByRole('combobox', { name: 'Group' }) as HTMLSelectElement).value).toBe('variantA'))
  expect(within(dialog).getByRole('option', { name: 'Newest shorter form' })).toBeTruthy()
  expect(within(dialog).queryByRole('option', { name: 'Shorter form' })).toBeNull()
  expect(within(dialog).queryByRole('option', { name: 'Unchanged form' })).toBeNull()
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/results'))).toHaveLength(1)
  const button = within(dialog).getByRole('button', { name: 'Decide' })
  act(() => { button.click(); button.click() })
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  const [url, request] = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(url).toBe('/api/xp/experiments/1/decide')
  expect(JSON.parse(request!.body as string)).toEqual({ winnerArm: 'variantA' })
  await act(async () => { finish(json({ status: 'decided' })) })
  expect(reloadPage).toHaveBeenCalledTimes(1)
})
test('the shared Decide dialog keeps its selection and note while the body refreshes', async () => {
  const realUseResults = resultsHook.useResults
  let reload!: () => void
  vi.spyOn(resultsHook, 'useResults').mockImplementation((...args) => {
    const results = realUseResults(...args)
    reload = results.reload
    return results
  })
  const fetcher = setup()
  render(<ResultsBody id={1} surface={surface} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Decide' }))
  const dialog = screen.getByRole('dialog')
  const group = within(dialog).getByRole('combobox', { name: 'Group' }) as HTMLSelectElement
  await waitFor(() => expect(group.value).toBe('variantA'))
  fireEvent.change(group, { target: { value: 'control' } })
  fireEvent.change(within(dialog).getByLabelText('Decision note'), { target: { value: 'Keep this note' } })
  let finish!: (response: Response) => void
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation((url, init) => url.includes('phase=1') ? new Promise(resolve => { finish = resolve }) : original(url, init))
  act(() => reload())
  await screen.findByText('Refreshing…')
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(group.value).toBe('control')
  expect((within(dialog).getByLabelText('Decision note') as HTMLTextAreaElement).value).toBe('Keep this note')
  await act(async () => finish(json(response)))
  await screen.findByText('Shorter form is most likely to be best.')
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(group.value).toBe('control')
  expect((within(dialog).getByLabelText('Decision note') as HTMLTextAreaElement).value).toBe('Keep this note')
})
test('guarded decisions require a note and typed confirmation', async () => {
  setup({ experiment: response.experiment, phases: [phaseFor(fixture('T4'))], snapshot: fixture('T4') })
  render(<ResultsBody id={1} surface={surface} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Decide' }))
  const dialog = screen.getByRole('dialog')
  await waitFor(() => expect(within(dialog).queryByRole('status')).toBeNull())
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Group' }), { target: { value: 'variantA' } })
  const submit = within(dialog).getByRole('button', { name: 'Decide' }) as HTMLButtonElement
  expect(submit.disabled).toBe(true)
  fireEvent.change(within(dialog).getByLabelText('Decision note'), { target: { value: 'Owner decision' } })
  fireEvent.change(within(dialog).getByLabelText('Confirmation'), { target: { value: 'Shorter form' } })
  expect(submit.disabled).toBe(false)
})
test.each(['running', 'stopped'] as const)('older rounds never inherit running context or current-round Decide (%s)', async status => {
  const old = fixture('T4'), newest = { ...fixture('T4'), phase: 2 }
  const phases = [phaseFor(old), phaseFor(newest)]
  const fetcher = setup()
  fetcher.mockImplementation(async url => {
    if (url.includes('/xp-experiments/')) return json({ ...doc, status })
    if (url.endsWith('/preflight')) return json({ placements: [] })
    return json({ phases, snapshot: url.includes('phase=1') ? old : newest })
  })
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  await screen.findByRole('button', { name: 'Decide' })
  if (status === 'running') expect(container.querySelector('.xp-power')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Round' }), { target: { value: '1' } })
  await screen.findByRole('table', { name: 'Registrations' })
  expect(container.querySelector('.xp-power')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Decide' })).toBeNull()
})
test('rollouts have no Decide; decided tests retain their frozen decision finding', async () => {
  const rollout = fixture('R3')
  const phases = [phase, { ...phaseFor(rollout), phase: 2 }]
  setup({ experiment: response.experiment, phases, snapshot, decisionSnapshot: snapshot }, { ...doc, status: 'decided', decision: { phase: 1, winnerArm: 'variantA' } } as typeof doc)
  render(<ResultsBody id={1} surface={surface} />)
  await screen.findByRole('heading', { name: 'Decided: Shorter form' })
  expect(screen.getByText(snapshot.verdict.finding)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Decide' })).toBeNull()
})
test('errors, missing and empty results render distinct states', async () => {
  for (const [status, expected] of [[403, "You don't have access to results."], [404, 'This test no longer exists.'], [500, 'Retry']] as const) {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, status)))
    const view = render(<ResultsBody id={1} surface={{ ...surface, canManage: false }} />)
    await screen.findByText(expected)
    view.unmount()
  }
  setup({ experiment: response.experiment, phases: [], snapshot: null })
  render(<ResultsBody id={1} surface={{ ...surface, canManage: false }} />)
  expect(await screen.findByText(/No results yet/)).toBeTruthy()
})
test('surface sources have no document Form or document/form hooks', () => {
  for (const name of ['ResultsBody.tsx', 'useResults.ts']) {
    const source = readFileSync(new NodeURL(`../../../../src/admin/surface/results/${name}`, import.meta.url), 'utf8')
    expect(source).not.toMatch(/\b(useDocumentInfo|useFormFields|Form)\b/)
  }
})

test.each(['variantA', null])('results-only readers see the actual decided winner rather than recommendation %s', async recommendedArm => {
  const decisionSnapshot = fixture('T7')
  decisionSnapshot.verdict.recommendedArm = recommendedArm
  // The editor chose another version despite the stored recommendation.
  const data = { experiment: response.experiment, phases: [phase, { ...phaseFor(fixture('R3')), phase: 2 }], snapshot: decisionSnapshot, decisionSnapshot,
    decision: { phase: 1, winnerArm: 'variantB' } }
  const fetcher = setup(data)
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation((url, init) => url.includes('/xp-experiments/') ? Promise.resolve(json({}, 403)) : original(url, init))
  render(<ResultsBody id={1} surface={{ ...surface, canManage: false }} />)
  await screen.findByRole('heading', { name: 'Decided: One page form' })
  expect(screen.getByText(decisionSnapshot.verdict.finding)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Decide' })).toBeNull()
  expect(fetcher.mock.calls.some(([url]) => url.includes('/xp-experiments/'))).toBe(false)
})
test.each([true, false])('archived document status wins for managers; readers infer decided without a document (%s)', async canManage => {
  const decision = { phase: snapshot.phase, winnerArm: 'variantA' }
  const fetcher = setup({ ...response, decision, decisionSnapshot: snapshot }, { ...doc, status: 'archived' })
  render(<ResultsBody id={1} surface={{ ...surface, canManage }} />)
  const title = canManage ? snapshot.verdict.headline : 'Decided: Shorter form'
  expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: canManage ? 'Decided: Shorter form' : snapshot.verdict.headline })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Decide' })).toBeNull()
  expect(fetcher.mock.calls.some(([url]) => url.includes('/xp-experiments/'))).toBe(canManage)
})
test('a decided test whose decision round was still collecting reads as stopped, not keep running', async () => {
  const collecting = fixture('T4')
  setup({ experiment: response.experiment, phases: [phaseFor(collecting)], snapshot: collecting, decisionSnapshot: collecting },
    { ...doc, status: 'decided', decision: { phase: phaseFor(collecting).phase, winnerArm: 'control' } } as typeof doc)
  render(<ResultsBody id="xp/one" surface={surface} />)
  expect(await screen.findByText('Stopped before enough people took part to tell.')).toBeTruthy()
  expect(screen.queryByText(/Keep it running|more people needed/)).toBeNull()
})

test('confidence chart starts collapsed and opens from its summary', async () => {
  setup()
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  await screen.findByRole('table', { name: 'Registrations' })
  const details = container.querySelector<HTMLDetailsElement>('.xp-chart-details')!
  expect(details.open).toBe(false)
  expect(details.hasAttribute('open')).toBe(false)
  fireEvent.click(within(details).getByText('Confidence interval over time'))
  expect(details.open).toBe(true)
  expect(screen.getByRole('img')).toBeTruthy()
})
test.each(['T4', 'T7-bayesian'])('%s tiles use stored exposures, elapsed days and the named leader probability', async name => {
  const snapshot = fixture(name)
  setup({ phases: [phaseFor(snapshot)], snapshot })
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  await screen.findByRole('table', { name: 'Registrations' })
  const tiles = container.querySelectorAll('.xp-stat-tile')
  expect(tiles).toHaveLength(3)
  expect(tiles[0]?.querySelector('.xp-stat-tile-value')?.textContent).toBe(snapshot.exposures.total.toLocaleString('en-US'))
  expect(tiles[1]?.textContent).toMatch(/^Days\d+ of 28$/)
  expect(tiles[2]?.querySelector('.xp-stat-tile-value')?.textContent).toBe(name === 'T4' ? '—' : '97.8%')
  if (name !== 'T4') expect(tiles[2]?.querySelector('.xp-results-swatch')).toBeTruthy()
  expect(container.textContent).not.toContain('Mean')
})

test.each([
  { status: 'decided', hasDecisionSnapshot: true, frozen: true },
  { status: 'running', hasDecisionSnapshot: true, frozen: false },
  { status: 'stopped', hasDecisionSnapshot: true, frozen: false },
  { status: 'decided', hasDecisionSnapshot: false, frozen: false },
])('$status results use the right numbers throughout (decision snapshot: $hasDecisionSnapshot)', async ({ status, hasDecisionSnapshot, frozen }) => {
  const stored = fixture('T7-bayesian')
  const revenue = revenueSnapshot()
  stored.metrics.push({ ...revenue.metrics[0]!, role: 'secondary' }, {
    ...structuredClone(stored.metrics[0]!), metricId: 'visits', name: 'Visits', kind: 'count', role: 'secondary',
    perArm: stored.metrics[0]!.perArm.map(arm => ({ ...arm, mean: 3.5 })),
  })
  stored.params.caps = revenue.params.caps
  stored.exposures.armMismatch = 3
  const newest = structuredClone(stored)
  newest.exposures.total = 4999
  newest.exposures.armMismatch = 7
  newest.window.to = '2026-10-31T20:00:00.000Z'
  newest.verdict.finding = newest.verdict.headline = 'Newest finding (71%).'
  newest.guardrails[0]!.status = 'warning'
  newest.params.caps.gifts!.resolvedCap = 300
  for (const metric of newest.metrics) {
    metric.perArm = metric.perArm.map(arm => ({ ...arm, n: 333, converters: 111, mean: metric.kind === 'binomial' ? .2 : 99,
      ...(arm.capped ? { capped: { resolvedCap: 300, uncappedTotal: 999, cappedCount: 9 } } : {}) }))
    metric.comparisons = metric.comparisons.map(comparison => ({ ...comparison, chanceToWin: .71 }))
  }
  setup({ phases: [phaseFor(stored)], snapshot: newest, ...(hasDecisionSnapshot ? { decisionSnapshot: stored } : {}),
    decision: { phase: 1, winnerArm: 'variantA' }, series: response.series }, { ...doc, status })
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  await screen.findByRole('table', { name: 'Registrations' })
  const tiles = container.querySelectorAll('.xp-stat-tile-value')
  expect(tiles[0]?.textContent).toBe(frozen ? '4,200' : '4,999')
  expect(tiles[1]?.textContent).toBe(frozen ? '14 of 28' : '15 of 28')
  expect(tiles[2]?.textContent).toBe(frozen ? '97.8%' : '71.0%')
  const primary = screen.getByRole('table', { name: 'Registrations' })
  const variantRow = within(primary).getByRole('rowheader', { name: 'Shorter form' }).parentElement!
  const primaryCells = within(variantRow).getAllByRole('cell')
  expect(primaryCells[0]?.textContent).toBe(frozen ? '1,980' : '333')
  expect(primaryCells[1]?.textContent).toBe(frozen ? '887' : '111')
  expect(primaryCells[5]?.textContent).toBe(frozen ? '97.8%' : '71.0%')
  const guardrail = screen.getByRole('table', { name: 'Completed lessons' })
  expect(within(guardrail).getAllByRole('cell')[1]?.textContent).toBe(frozen ? '80.0%' : '20.0%')
  const visits = screen.getByRole('table', { name: 'Visits' })
  expect(within(visits).getAllByRole('cell')[1]?.textContent).toBe(frozen ? '3.5' : '99')
  const gifts = screen.getByRole('table', { name: 'Gifts' })
  expect(within(gifts).getAllByText(frozen ? '0 capped at $100.00' : '9 capped at $300.00')).toHaveLength(3)
  expect(screen.getByText(frozen ? '3 ignored.' : '7 ignored.')).toBeTruthy()
  expect(container.querySelector('.xp-results-chips')?.textContent).toContain(frozen ? 'OK' : 'Watch')
  if (frozen) expect(screen.getByText(stored.verdict.finding)).toBeTruthy()
  // The decision's numbers never move, so the page says why and offers no Recompute.
  expect(container.querySelector('.xp-results-as-of')?.textContent ?? null).toEqual(frozen ? expect.stringMatching(/^· as of the decision, \d{1,2} [A-Z][a-z]{2} \d{4}$/) : null)
  expect(screen.queryByRole('button', { name: 'Recompute' }) === null).toBe(frozen)
  if (status !== 'decided') expect(screen.getByRole('heading', { name: newest.verdict.headline })).toBeTruthy()
  for (const table of screen.getAllByRole('table')) {
    expect(table.parentElement?.getAttribute('aria-label')).toBe(table.querySelector('caption')?.textContent)
    expect(table.parentElement?.tabIndex).toBe(0)
  }
  // The confidence chart retains the endpoint's historical series.
  fireEvent.click(screen.getByText('Confidence interval over time'))
  expect(screen.getByRole('img').querySelector('[data-series="variantA"] path')?.getAttribute('d')).toBeTruthy()
})

test('shipping round keeps the newest snapshot even when a decision snapshot is present', async () => {
  const rollout = fixture('R3')
  setup({ phases: [phase, phaseFor(rollout)], snapshot: rollout, decisionSnapshot: fixture('T7-bayesian'),
    decision: { phase: 1, winnerArm: 'variantA' } }, { ...doc, status: 'decided' })
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  await screen.findByRole('table', { name: 'Registrations' })
  fireEvent.change(screen.getByRole('combobox', { name: 'Round' }), { target: { value: String(rollout.phase) } })
  await screen.findByRole('heading', { name: rollout.verdict.headline })
  expect(container.querySelector('.xp-stat-tile-value')?.textContent).toBe(rollout.exposures.total.toLocaleString('en-US'))
  expect(screen.getByRole('heading', { name: rollout.verdict.headline })).toBeTruthy()
})
test('data quality opens automatically for Watch and stays collapsed for OK', async () => {
  setup({ ...response, snapshot: { ...snapshot, exposures: { ...snapshot.exposures, armMismatch: 1 } } })
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  await screen.findByRole('table', { name: 'Registrations' })
  expect(container.querySelector<HTMLDetailsElement>('.xp-data-quality')?.open).toBe(true)
  expect(container.querySelector('.xp-data-quality summary')?.textContent).toBe('Data qualityWatch')
})
test('archived test initially requests the decision round rather than a newer rollout', async () => {
  const rollout = { ...fixture('R3'), phase: 2 }
  const phases = [phase, phaseFor(rollout)]
  const fetcher = setup()
  fetcher.mockImplementation(async url => url.includes('/xp-experiments/') ? json({ ...doc, status: 'archived', decision: { phase: 1, winnerArm: 'variantA' } })
    : url.endsWith('/preflight') ? json({ placements: [] })
      : json({ phases, snapshot: url.includes('phase=1') ? snapshot : rollout }))
  render(<ResultsBody id={1} surface={surface} />)
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Round' }) as HTMLSelectElement).value).toBe('1'))
  await screen.findByRole('heading', { name: snapshot.verdict.headline })
  expect(fetcher.mock.calls.some(([url]) => url.includes('phase=1'))).toBe(true)
})
test('reader sees the round but never the analysis method', async () => {
  setup()
  render(<ResultsBody id={1} surface={{ ...surface, canManage: false }} />)
  await screen.findByRole('table', { name: 'Registrations' })
  expect(screen.getByRole('combobox', { name: 'Round' })).toBeTruthy()
  expect(screen.queryByText(/Sequential|Bayesian/)).toBeNull()
})
test('flag placements without preview or editor links do not render dead-end rows', async () => {
  const fetcher = setup()
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation((url, init) => url.includes('/xp-experiments/') ? Promise.resolve(json({ ...doc, flagPoint: 'signup-choice' }))
    : url.endsWith('/preflight') ? Promise.resolve(json({ placements: [
      { collection: 'signup-choice', id: 'variantA', title: 'Signup page', ok: true },
      { collection: 'signup-choice', id: 'variantA', title: 'Another signup page', ok: true },
    ] })) : original(url, init))
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  await screen.findByRole('table', { name: 'Registrations' })
  expect(screen.queryByText('Another signup page')).toBeNull()
  expect(screen.queryByText(/Preview isn't set up/)).toBeNull()
  expect(container.querySelectorAll('.xp-preview-row')).toHaveLength(0)
  expect(container.textContent).not.toMatch(/placed \d+ times/)
})
test('Decide receives the localized warning from the existing preflight request', async () => {
  const fetcher = setup()
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation((url, init) => url.endsWith('/preflight') ? Promise.resolve(json({ placements: [], checks: [
    { code: 'make-content-unsupported', ok: true, warning: true, detail: 'Landing page' },
  ] })) : original(url, init))
  render(<ResultsBody id={1} surface={surface} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Decide' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText("Landing page has more than one language, so Make it the content isn't available for it; you'll copy the winning version by hand.")).toBeTruthy()
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/preflight'))).toHaveLength(1)
})


test('only the primary block emphasises the leader alongside guardrail and supporting tables', async () => {
  const snapshot = fixture('T7')
  snapshot.metrics.push({ ...snapshot.metrics[0]!, metricId: 'supporting', name: 'Supporting outcome', role: 'secondary' })
  setup({ phases: [phaseFor(snapshot)], snapshot })
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  const primary = await screen.findByRole('table', { name: 'Registrations' })
  const guardrail = screen.getByRole('table', { name: 'Completed lessons' })
  const supporting = screen.getByRole('table', { name: 'Supporting outcome' })
  expect(container.querySelectorAll('.is-lead')).toHaveLength(1)
  expect(primary.closest('.xp-results-block')?.querySelector('.is-lead')).toBeTruthy()
  expect(guardrail.querySelector('.is-lead')).toBeNull()
  expect(supporting.querySelector('.is-lead')).toBeNull()
})
test.each([['T7', 'Sequential'], ['T7-bayesian', 'Bayesian']])('manager sees %s analysis method in the meta row', async (name, method) => {
  const snapshot = fixture(name)
  setup({ phases: [phaseFor(snapshot)], snapshot })
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  await screen.findByRole('table', { name: 'Registrations' })
  expect(container.querySelector('.xp-round-meta')?.textContent).toContain(method)
})
test('readers see when a decided round was recorded, with no leading separator and no Recompute', async () => {
  const stored = fixture('T7-bayesian')
  setup({ phases: [phaseFor(stored)], snapshot: stored, decisionSnapshot: stored, decision: { phase: 1, winnerArm: 'variantA' } })
  const { container } = render(<ResultsBody id={1} surface={{ ...surface, canManage: false }} />)
  await screen.findByRole('table', { name: 'Registrations' })
  expect(container.querySelector('.xp-results-as-of')?.textContent).toMatch(/^as of the decision, \d{1,2} [A-Z][a-z]{2} \d{4}$/)
  expect(screen.queryByRole('button', { name: 'Recompute' })).toBeNull()
})

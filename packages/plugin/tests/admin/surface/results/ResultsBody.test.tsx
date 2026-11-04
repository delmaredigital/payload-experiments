// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { ResultsBody } from '../../../../src/admin/surface/results/ResultsBody.js'
import * as resultsHook from '../../../../src/admin/surface/results/useResults.js'
import { reloadPage } from '../../../../src/admin/reload.js'
import type { SurfaceProps } from '../../../../src/admin/surface/contracts.js'
import { fixture, phaseFor } from '../../results/fixtures.js'
import type { ResultsResponse } from '../../../../src/types/endpoints.js'
vi.mock('@payloadcms/ui', async () => (await import('../../_helpers/payloadUiMock.js')).payloadUiMock())
vi.mock('../../../../src/admin/reload.js', () => ({ reloadPage: vi.fn() }))
const surface: SurfaceProps = { adminRoute: '/admin', apiRoute: '/api', canManage: true, canReadResults: true, isAdmin: false, flagPoints: [], attributeKeys: {}, metricSources: [] }
const snapshot = fixture('T7')
const phase = phaseFor(snapshot)
const response: ResultsResponse = { phases: [phase], snapshot, series: ['2026-10-29', '2026-10-30'].map(computedAt => ({ computedAt, metricId: 'registrations', arm: 'variantA', lift: 0.1, ci: [0, 0.2] })) }
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })
test.each(['running', 'stopped'])('collecting results show the stored detail without duplicate counts when %s', async status => {
  const collecting = fixture(status === 'running' ? 'T4' : 'T4-stopped')
  setup({ phases: [phaseFor(collecting)], snapshot: collecting }, { ...doc, status })
  const { container } = render(<ResultsBody id={1} surface={surface} />)
  expect(await screen.findByText(collecting.verdict.detail)).toBeTruthy()
  expect(container.querySelector('.xp-collecting')).toBeNull()
  expect(container.textContent).not.toContain('360 of 1,000 people, 37 of 150 conversions')
})
test('composes recommendation above the headline, tables, chart, data quality, round and previews', async () => {
  setup({ ...response, snapshot: { ...snapshot, exposures: { ...snapshot.exposures, armMismatch: 1 } } })
  const { container } = render(<ResultsBody id="xp/one" surface={surface} />)
  const sentence = await screen.findByText('Shorter form is most likely to be best.')
  const heading = screen.getByRole('heading', { name: snapshot.verdict.headline })
  expect(sentence.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Registrations' })).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Completed lessons' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Data quality' })).toBeTruthy()
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
  const fetcher = setup({ phases: [phase, newestPhase], snapshot: newest })
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
  setup({ phases: [phaseFor(fixture('T4'))], snapshot: fixture('T4') })
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
  setup({ phases, snapshot, decisionSnapshot: snapshot }, { ...doc, status: 'decided', decision: { phase: 1, winnerArm: 'variantA' } } as typeof doc)
  render(<ResultsBody id={1} surface={surface} />)
  await screen.findByRole('heading', { name: 'Decided: Shorter form' })
  expect(screen.getByText(snapshot.verdict.finding)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Decide' })).toBeNull()
})
test('errors, missing and empty results render distinct states', async () => {
  for (const [status, expected] of [[403, "You don't have access to results."], [404, "This test couldn't be found."], [500, 'Retry']] as const) {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, status)))
    const view = render(<ResultsBody id={1} surface={{ ...surface, canManage: false }} />)
    await screen.findByText(expected)
    view.unmount()
  }
  setup({ phases: [], snapshot: null })
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
  const data = { phases: [phase, { ...phaseFor(fixture('R3')), phase: 2 }], snapshot: decisionSnapshot, decisionSnapshot,
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
  setup({ phases: [phaseFor(collecting)], snapshot: collecting, decisionSnapshot: collecting },
    { ...doc, status: 'decided', decision: { phase: phaseFor(collecting).phase, winnerArm: 'control' } } as typeof doc)
  render(<ResultsBody id="xp/one" surface={surface} />)
  expect(await screen.findByText('Stopped before enough people took part to tell.')).toBeTruthy()
  expect(screen.queryByText(/Keep it running|more people needed/)).toBeNull()
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

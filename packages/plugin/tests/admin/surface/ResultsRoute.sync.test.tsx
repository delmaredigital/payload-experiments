// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ResultsRoute } from '../../../src/admin/surface/ResultsRoute.js'
import { props } from './readiness/fixtures.js'
import { fixture, phaseFor } from '../results/fixtures.js'

const mocks = vi.hoisted(() => ({ hook: vi.fn() }))
vi.mock('../../../src/admin/surface/useTestDocument.js', () => ({ useTestDocument: mocks.hook }))
vi.mock('../../../src/admin/surface/test/TestHeader.js', () => ({ TestHeader: () => <p>Test header</p> }))
vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const json = (body: unknown) => new Response(JSON.stringify(body))

test('stopping in the header fetches fresh results and removes the running sentence', async () => {
  const snapshot = fixture('T4')
  snapshot.power = { ...snapshot.power, feasible: true, daysRemaining: 0 }
  const phase = phaseFor(snapshot)
  let p = props({ id: 12, status: 'running', phase: 1 })
  const surface = { ...p.surface, canReadResults: true }
  mocks.hook.mockImplementation(() => p.test)
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/xp-experiments/')) return json(p.test.doc)
    if (url.endsWith('/preflight')) return json({ placements: [] })
    return json({ phases: [phase], snapshot })
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(<ResultsRoute id={12} surface={surface} />)
  await screen.findByText('Keep running to the planned end date.')
  const resultReads = () => fetcher.mock.calls.filter(([url]) => url.includes('/results?')).length
  const before = resultReads()
  p = props({ ...p.test.doc!, status: 'stopped' })
  view.rerender(<ResultsRoute id={12} surface={surface} />)
  await screen.findByRole('table', { name: 'Registrations' })
  await waitFor(() => expect(resultReads()).toBeGreaterThan(before))
  expect(screen.queryByText('Keep running to the planned end date.')).toBeNull()
})

test.each([{ phase: 2 }, { allocation: 80 }, { metrics: { primary: 1, secondary: [2, 4], guardrails: [3] } }])('header change %j refetches the results body', async update => {
  let p = props({ id: 12, status: 'running', phase: 1, allocation: 40 })
  const surface = { ...p.surface, canReadResults: true }
  mocks.hook.mockImplementation(() => p.test)
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/xp-experiments/')) return json(p.test.doc)
    if (url.endsWith('/preflight')) return json({ placements: [] })
    return json({ phases: [], snapshot: null })
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(<ResultsRoute id={12} surface={surface} />)
  await screen.findByText(/No results yet/)
  const before = fetcher.mock.calls.filter(([url]) => url.includes('/results?')).length
  p = props({ ...p.test.doc!, ...update })
  view.rerender(<ResultsRoute id={12} surface={surface} />)
  await screen.findByText(/No results yet/)
  expect(fetcher.mock.calls.filter(([url]) => url.includes('/results?'))).toHaveLength(before + 1)
})

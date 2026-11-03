// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ResultsRoute } from '../../../src/admin/surface/ResultsRoute.js'
import { runningCopy } from '../../../src/admin/copy/readiness.js'
import { props } from './readiness/fixtures.js'

const mocks = vi.hoisted(() => ({ hook: vi.fn() }))
vi.mock('../../../src/admin/surface/useTestDocument.js', () => ({ useTestDocument: mocks.hook }))
vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const summaryResponse = (exposures: number) => json({ 12: { exposures, days: 1, verdict: null } })

async function renderRunning(recompute = json({ snapshotId: 'new-snapshot' })) {
  const p = props({ id: 12, status: 'running', phase: 1, analysis: null })
  mocks.hook.mockReturnValue(p.test)
  const summary = vi.fn().mockResolvedValueOnce(summaryResponse(0)).mockResolvedValue(summaryResponse(31))
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/summary?')) return summary()
    if (url.endsWith('/recompute')) return recompute
    if (url.includes('/xp-experiments/')) return json(p.test.doc)
    if (url.endsWith('/preflight')) return json({ placements: [] })
    return json({ phases: [], snapshot: null })
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ResultsRoute id={12} surface={{ ...p.surface, canReadResults: true }} />)
  await screen.findByText(runningCopy(null, 0, null))
  await screen.findByText(/No results yet/)
  return { summary, fetcher }
}

test('successful Recompute refreshes the running banner from 0 to 31 people', async () => {
  const { summary, fetcher } = await renderRunning()
  const resultReads = () => fetcher.mock.calls.filter(([url]) => url.includes('/results?')).length
  const before = resultReads()
  fireEvent.click(screen.getByRole('button', { name: 'Recompute' }))
  await screen.findByText(runningCopy(null, 31, null))
  expect(summary).toHaveBeenCalledTimes(2)
  expect(resultReads()).toBe(before + 1)
})

test('a failed Recompute does not refetch the banner summary', async () => {
  const { summary } = await renderRunning(json({ errors: [{ message: 'Recompute was refused.' }] }, 409))
  fireEvent.click(screen.getByRole('button', { name: 'Recompute' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Recompute was refused.')
  expect(summary).toHaveBeenCalledTimes(1)
  expect(screen.getByText(runningCopy(null, 0, null))).toBeTruthy()
})

test('the banner retains its count and open dialog while the new summary loads', async () => {
  const { summary } = await renderRunning()
  let resolve!: (value: Response) => void
  summary.mockReturnValueOnce(new Promise<Response>(done => { resolve = done }))
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Recompute' }))
  await waitFor(() => expect(summary).toHaveBeenCalledTimes(2))
  expect(screen.getByText(runningCopy(null, 0, null))).toBeTruthy()
  expect(screen.queryAllByRole('status').map(item => item.textContent)).not.toContain(runningCopy(null, null, null))
  expect(screen.getByRole('dialog')).toBe(dialog)
  await act(async () => { resolve(summaryResponse(31)) })
  expect(screen.getByText(runningCopy(null, 31, null))).toBeTruthy()
  expect(screen.getByRole('dialog')).toBe(dialog)
})

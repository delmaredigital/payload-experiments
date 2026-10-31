// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { PreflightResult, RefusalCode } from '../../../src/types/endpoints.js'
import { ReviewPanel } from '../../../src/admin/review/ReviewPanel.js'
import { reloadPage } from '../../../src/admin/reload.js'
import { resetPayloadUiMock, setDocumentInfo, setEntityConfig, setForm, setFormFields, setFormModified } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
vi.mock('../../../src/admin/reload.js', () => ({ reloadPage: vi.fn() }))
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const preflight: PreflightResult = {
  checks: [{ code: 'no-primary-metric', ok: true }, { code: 'empty-slot', ok: true }],
  placements: [{ collection: 'pages', id: 1, title: 'Home', url: '/home', ok: true, detail: 'Both groups ready.' }],
  baseline: null, trafficPerDay: 100,
  estimate: { weeks: 9, plannedDurationDays: 63, sequentialTuningParameter: 100, feasible: true },
}
const panel = () => render(<ReviewPanel field={{ name: 'review', type: 'ui', admin: {} }} path="review" />)
test('create form asks for a save and does not fetch', () => {
  setDocumentInfo({ id: undefined })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  panel()
  expect(screen.getByText('Save the experiment to review it.')).toBeTruthy()
  expect(fetcher).not.toHaveBeenCalled()
})
test('renders checks, placements and estimate; Apply updates both fields, marks modified and refetches', async () => {
  const dispatchFields = vi.fn(), setModified = vi.fn()
  setForm({ dispatchFields, setModified })
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response(preflight)))
  vi.stubGlobal('fetch', fetcher)
  panel()
  await screen.findByText('✓ Main metric chosen')
  expect(screen.queryByText(/Choose the main metric in Metrics/)).toBeNull()
  expect(screen.getByText('Both groups ready.')).toBeTruthy()
  expect(screen.getByText('≈ 9 weeks').className).toBe('xp-review__warning')
  expect((screen.getByLabelText('Planned duration (days)') as HTMLInputElement).value).toBe('63')
  expect((screen.getByLabelText('Sensitivity setting (prefilled; leave as is unless a developer says otherwise)') as HTMLInputElement).value).toBe('100')
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(dispatchFields.mock.calls).toEqual([
    [{ type: 'UPDATE', path: 'analysis.plannedDurationDays', value: 63 }],
    [{ type: 'UPDATE', path: 'analysis.sequentialTuningParameter', value: 100 }],
  ])
  expect(setModified).toHaveBeenCalledWith(true)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
})
test('failing checks show fix hints and fallback detail appears only once', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...preflight, checks: [
    { code: 'no-primary-metric', ok: false },
    { code: 'future-check' as RefusalCode, ok: false, detail: { message: 'Fix the page.' } },
  ] })))
  panel()
  expect(await screen.findByText('✗ Choose the main metric in Metrics.')).toBeTruthy()
  expect(screen.queryByText(/Main metric chosen/)).toBeNull()
  expect(screen.getAllByText(/Fix the page\./)).toHaveLength(1)
  expect(screen.queryByText(/future-check/)).toBeNull()
})
test('Apply is disabled while running with a locked reason', async () => {
  setFormFields({ status: { value: 'running' } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(preflight)))
  panel()
  const apply = await screen.findByRole('button', { name: 'Apply' }) as HTMLButtonElement
  expect(apply.disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(/Locked while the test is running/)).toBeTruthy()
})
test('Apply then Save refreshes the saved checklist and enables Start without remounting', async () => {
  setDocumentInfo({ id: '1', data: { updatedAt: '2026-10-30T22:00:00Z' } })
  setForm({ dispatchFields: vi.fn(), setModified: () => setFormModified(true) })
  const needsDuration = { ...preflight, checks: [{ code: 'no-planned-duration', ok: false }] }
  const fetcher = vi.fn().mockResolvedValueOnce(response(needsDuration)).mockResolvedValueOnce(response(needsDuration))
    .mockResolvedValueOnce(response({ ...preflight, checks: [{ code: 'no-planned-duration', ok: true }] }))
  vi.stubGlobal('fetch', fetcher)
  panel()
  const start = await screen.findByRole('button', { name: 'Start' }) as HTMLButtonElement
  expect(start.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(start.disabled).toBe(true)
  expect(screen.getByText('Save your changes first; Start uses the saved experiment.')).toBeTruthy()
  act(() => {
    setFormModified(false)
    setDocumentInfo({ id: '1', data: { updatedAt: '2026-10-30T22:01:00Z' } })
  })
  await waitFor(() => expect(start.disabled).toBe(false))
  expect(fetcher).toHaveBeenCalledTimes(3)
})
test('draft Start posts directly, guards rapid clicks and stays busy until reload', async () => {
  setFormFields({ status: { value: 'draft' } })
  let resolve!: (value: Response) => void
  const pending = new Promise<Response>(done => { resolve = done })
  const fetcher = vi.fn().mockResolvedValueOnce(response(preflight)).mockReturnValue(pending)
  vi.stubGlobal('fetch', fetcher)
  panel()
  const start = await screen.findByRole('button', { name: 'Start' }) as HTMLButtonElement
  act(() => { start.click(); start.click() })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls[1]?.[0]).toBe('/api/xp/experiments/1/start')
  expect(start.disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
  resolve(response({ doc: {}, revision: 2 }))
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  expect(start.disabled).toBe(true)
  fireEvent.click(start)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
test('stopped Start confirms a new round before posting and stays busy until reload', async () => {
  setFormFields({ status: { value: 'stopped' } })
  let resolve!: (value: Response) => void
  const pending = new Promise<Response>(done => { resolve = done })
  const fetcher = vi.fn().mockResolvedValueOnce(response(preflight)).mockReturnValue(pending)
  vi.stubGlobal('fetch', fetcher)
  panel()
  const start = await screen.findByRole('button', { name: 'Start a new round' }) as HTMLButtonElement
  fireEvent.click(start)
  const dialog = screen.getByRole('dialog', { name: 'Start a new round' })
  expect(within(dialog).getByText('Starting again begins a new round; results restart.')).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(start.disabled).toBe(true)
  const submit = within(dialog).getByRole('button', { name: 'Start a new round' }) as HTMLButtonElement
  act(() => { submit.click(); submit.click() })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls[1]?.[0]).toBe('/api/xp/experiments/1/start')
  expect(submit.disabled).toBe(true)
  expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
  resolve(response({ doc: {}, revision: 2 }))
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  expect(start.disabled).toBe(true)
  expect(submit.disabled).toBe(true)
})
test('cancelling a stopped Start does not post', async () => {
  setFormFields({ status: { value: 'stopped' } })
  const fetcher = vi.fn().mockResolvedValue(response(preflight))
  vi.stubGlobal('fetch', fetcher)
  panel()
  const start = await screen.findByRole('button', { name: 'Start a new round' }) as HTMLButtonElement
  fireEvent.click(start)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(start.disabled).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
test.each(['draft', 'stopped'])('unsaved %s form disables Start and explains the saved-document behavior', async status => {
  setFormFields({ status: { value: status } })
  setFormModified(true)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(preflight)))
  panel()
  const start = await screen.findByRole('button', { name: status === 'stopped' ? 'Start a new round' : 'Start' }) as HTMLButtonElement
  expect(start.disabled).toBe(true)
  fireEvent.click(start)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByText('Save your changes first; Start uses the saved experiment.')).toBeTruthy()
})
test('failed preflight offers Retry using Review copy', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ errors: [{ code: 'stale-draft', message: 'Reload the saved experiment.' }] }, 409))
    .mockResolvedValueOnce(response(preflight))
  vi.stubGlobal('fetch', fetcher)
  panel()
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('✓ Main metric chosen')).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(2)
})
test('refused Start shows the message and permits retry without reloading', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(preflight)).mockResolvedValueOnce(response({ errors: [{ code: 'stale-draft', message: 'Reload the saved experiment.' }] }, 409)))
  panel()
  fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Reload the saved experiment.')
  expect(reloadPage).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(false)
})
test('formats the saved primary metric baseline using its registered source kind', async () => {
  setEntityConfig({ fields: [{ name: 'source', admin: { custom: { sources: [{ id: 'registration', kind: 'binomial' }] } } }] })
  const fetcher = vi.fn().mockResolvedValueOnce(response({ ...preflight, baseline: { metricId: 5, value: 0.2, days: 28 } }))
    .mockResolvedValueOnce(response({ id: 5, source: 'registration' }))
  vi.stubGlobal('fetch', fetcher)
  panel()
  expect(await screen.findByText('Over the last 28 days: 20%')).toBeTruthy()
  expect(fetcher.mock.calls[1]?.[0]).toBe('/api/xp-metrics/5?depth=0')
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AddMetricDialog } from '../../../src/admin/actions/AddMetricDialog.js'
import { reloadPage } from '../../../src/admin/reload.js'
import { resetPayloadUiMock, setAuth, setConfig, setFormFields } from '../_helpers/payloadUiMock.js'
import { ExperimentActions } from '../../../src/admin/actions/ExperimentActions.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
vi.mock('../../../src/admin/reload.js', () => ({ reloadPage: vi.fn() }))
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const metrics = { docs: [{ id: 1, name: 'Main' }, { id: 2, name: 'Attached' }, { id: 3, name: 'Donations' }] }
test.each(['secondary', 'guardrail'])('excludes attached metrics and sends the %s body, retaining the numeric id', async role => {
  setConfig({ config: { routes: { api: '/custom-api', admin: '/admin' } } })
  let resolve!: (response: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(response(metrics)).mockReturnValue(new Promise<Response>(done => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  render(<AddMetricDialog id="xp1" attachedMetrics={['1', 2]} onClose={vi.fn()} />)
  await screen.findByRole('option', { name: 'Donations' })
  expect(screen.queryByRole('option', { name: 'Main' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Attached' })).toBeNull()
  expect(fetcher.mock.calls[0]?.[0]).toBe('/custom-api/xp-metrics?depth=0&limit=100')
  expect(fetcher.mock.calls[0]?.[1].credentials).toBe('include')
  fireEvent.change(screen.getByLabelText('Metric'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: role } })
  const submit = screen.getByRole('button', { name: 'Add a metric' }) as HTMLButtonElement
  act(() => { submit.click(); submit.click() })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls[1]?.[0]).toBe('/custom-api/xp/experiments/xp1/add-metric')
  expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ metric: 3, role })
  expect((screen.getByLabelText('Metric') as HTMLSelectElement).disabled).toBe(true)
  expect((screen.getByLabelText('Role') as HTMLSelectElement).disabled).toBe(true)
  resolve(response({ doc: {}, revision: 2 }))
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  expect(submit.disabled).toBe(true)
})
test('running actions open the metric picker excluding primary, supporting and guardrail relationships', async () => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  setFormFields({ status: { value: 'running' }, kind: { value: 'block' }, allocation: { value: 40 },
    'metrics.primary': { value: { id: 1 } }, 'metrics.secondary': { value: [2] }, 'metrics.guardrails': { value: [{ id: 3 }] } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ docs: [...metrics.docs, { id: '4', name: 'New outcome' }] })))
  render(<ExperimentActions field={{ name: 'actions', type: 'ui', admin: {} }} path="actions" />)
  fireEvent.click(screen.getByRole('button', { name: 'Raise allocation' }))
  expect((screen.getByLabelText('Allocation (%)') as HTMLInputElement).min).toBe('41')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add a metric' }))
  await screen.findByRole('option', { name: 'New outcome' })
  expect(screen.queryByRole('option', { name: 'Main' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Attached' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Donations' })).toBeNull()
})
test('picker load failure is visible and prevents submission', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 403)))
  render(<AddMetricDialog id={1} attachedMetrics={[]} onClose={vi.fn()} />)
  expect((await screen.findByRole('alert')).textContent).toBe("You don't have permission to do this.")
  expect((screen.getByRole('button', { name: 'Add a metric' }) as HTMLButtonElement).disabled).toBe(true)
})

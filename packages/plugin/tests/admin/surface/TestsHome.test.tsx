// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { TestsSurfaceProps } from '../../../src/types/surface.js'
import { payloadUiMock } from '../_helpers/payloadUiMock.js'
import { TestsHome } from '../../../src/admin/surface/TestsHome.js'
import { TestsSurface } from '../../../src/admin/surface/TestsSurface.js'

vi.mock('@payloadcms/ui', () => ({ ...payloadUiMock(), Link: (props: ComponentProps<'a'>) => <a {...props} /> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function fetchData(docs: unknown[], summaries = {}) {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/summary?') ? summaries : { docs })))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
test('loading then empty state with the creation and Goals links', async () => {
  const fetch = fetchData([])
  render(<TestsHome adminRoute="/control" apiRoute="/data" />)
  expect(screen.getByRole('status').textContent).toBe('Loading tests…')
  expect(await screen.findByText('Test a change to see what works best for the people who visit your pages.')).toBeTruthy()
  expect(screen.getAllByRole('link', { name: 'New test' }).every(link => link.getAttribute('href') === '/control/experiments/new')).toBe(true)
  expect(screen.getByRole('link', { name: 'Goals' }).getAttribute('href')).toBe('/control/collections/xp-metrics')
  expect(fetch.mock.calls[0]?.[0]).toBe('/data/xp-experiments?depth=0&sort=-updatedAt&limit=200')
  expect(fetch).toHaveBeenCalledOnce()
})
test('renders ordered groups, status, verdict, actions, and collapsed archive; search filters by name', async () => {
  const docs = [
    { id: 'a', name: 'Trouble', kind: 'block', status: 'running', analysis: { plannedDurationDays: 28 } },
    { id: 'b', name: 'Healthy', kind: 'flag', status: 'running' },
    { id: 'c', name: 'Ready draft', kind: 'code', status: 'draft' },
    { id: 'd', name: 'Needs setup', kind: 'page', status: 'stopped' },
    { id: 'e', name: 'Finished', kind: 'flag', status: 'decided' },
    { id: 'f', name: 'Old test', kind: 'flag', status: 'archived' },
  ]
  const fetch = fetchData(docs, { a: { exposures: 42, days: 3, verdict: { code: 'data-problem', headline: 'Check the data' } }, c: { ready: true } })
  const { container } = render(<TestsHome adminRoute="/admin" apiRoute="/api" />)
  await screen.findByText('Trouble')
  expect(screen.getAllByRole('region').map(region => region.getAttribute('aria-label'))).toEqual(['Needs attention', 'Running', 'Ready to start', 'Draft', 'Decided'])
  expect(screen.getByText('Running 3 days of 28 · 42 people so far')).toBeTruthy()
  expect(screen.getByText('Check the data')).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Stop and check' })).toBeTruthy()
  const archived = container.querySelector('details')!
  expect(archived.open).toBe(false)
  expect(archived.querySelector('summary')?.textContent).toBe('Archived')
  const trouble = screen.getByText('Trouble').closest('article')!
  expect(within(trouble).getByRole('link', { name: 'View results' }).getAttribute('href')).toBe('/admin/experiments/a/results')
  const draft = screen.getByText('Ready draft').closest('article')!
  expect(within(draft).getByRole('link', { name: 'Continue setup' }).getAttribute('href')).toBe('/admin/experiments/c')
  expect(fetch.mock.calls[1]?.[0]).toBe('/api/xp/experiments/summary?ids=a,b,c,d,e,f')
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'HEALTHY' } })
  expect(screen.queryByText('Trouble')).toBeNull()
  expect(screen.getByText('Healthy')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing' } })
  expect(screen.getByText('No tests match your search.')).toBeTruthy()
})
test('list failure offers a retry', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(JSON.stringify({ docs: [] })))
  vi.stubGlobal('fetch', fetch)
  render(<TestsHome adminRoute="/admin" apiRoute="/api" />)
  expect((await screen.findByRole('alert')).textContent).toContain('Tests could not be loaded.')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('Test a change to see what works best for the people who visit your pages.')
  expect(fetch).toHaveBeenCalledTimes(2)
})
test('a failed summary keeps the cards and explains the missing summaries', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('summary?') ? new Response('{}', { status: 503 })
    : new Response(JSON.stringify({ docs: [{ id: '1', name: 'My test', kind: 'flag', status: 'draft' }] }))))
  render(<TestsHome adminRoute="/admin" apiRoute="/api" />)
  await screen.findByText('My test')
  expect(screen.getByRole('alert').textContent).toContain('Some test summaries could not be loaded.')
})
test('summary requests batch at 100 ids', async () => {
  const docs = Array.from({ length: 101 }, (_, index) => ({ id: String(index), name: `Test ${index}`, kind: 'flag', status: 'draft' }))
  const fetch = fetchData(docs)
  render(<TestsHome adminRoute="/admin" apiRoute="/api" />)
  await screen.findByText('Test 100')
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
  expect(fetch.mock.calls[2]?.[0]).toBe('/api/xp/experiments/summary?ids=100')
})
test.each([
  ['new', 'New test setup is coming soon.'], ['test', 'Test setup is coming soon.'], ['results', 'Test results are coming soon.'],
] as const)('the shell routes %s and has a home link and main region', (route, text) => {
  const props: TestsSurfaceProps = { route, id: '123', adminRoute: '/control', apiRoute: '/data', canManage: true, canReadResults: true, flagPoints: [], metricSources: [], attributeKeys: {} }
  render(<TestsSurface {...props} />)
  expect(within(screen.getByRole('main')).getByText(text)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Tests' }).getAttribute('href')).toBe('/control/experiments')
})

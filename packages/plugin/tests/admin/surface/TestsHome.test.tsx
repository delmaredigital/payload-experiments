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
function fetchData(docs: unknown[], summaries = {}, totalDocs = docs.length) {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/summary?') ? summaries : { docs, totalDocs })))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
test('loading then empty state with the creation and Goals links', async () => {
  const fetch = fetchData([])
  render(<TestsHome adminRoute="/control" apiRoute="/data" canManage />)
  expect(screen.getByRole('status').textContent).toBe('Loading tests…')
  expect(await screen.findByText('Create a test to learn what works.')).toBeTruthy()
  expect(screen.getAllByRole('link', { name: 'New test' }).every(link => link.getAttribute('href') === '/control/experiments/new')).toBe(true)
  expect(screen.getByRole('link', { name: 'Goals' }).getAttribute('href')).toBe('/control/experiments/goals')
  const url = new URL(fetch.mock.calls[0]![0], 'https://example.test')
  expect(url.pathname).toBe('/data/xp-experiments')
  expect(Object.fromEntries(url.searchParams)).toEqual({
    depth: '0', sort: 'id', limit: '100', page: '1',
    'select[name]': 'true', 'select[kind]': 'true', 'select[status]': 'true',
    'select[analysis]': 'true', 'select[arms]': 'true', 'select[decidedAt]': 'true',
    'select[updatedAt]': 'true', 'select[decision]': 'true', 'select[unitType]': 'true', 'select[flagPoint]': 'true',
  })
  expect(fetch).toHaveBeenCalledOnce()
  expect(screen.queryByText('Showing the 200 most recent tests.')).toBeNull()
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
  const { container } = render(<TestsHome adminRoute="/admin" apiRoute="/api" canManage />)
  await screen.findByText('Trouble')
  expect(screen.getAllByRole('region').map(region => region.querySelector('h2')?.textContent)).toEqual(['Needs attention', 'Running', 'Ready to start', 'Draft', 'Decided'])
  expect(screen.getByText('Running 3 days of 28 · 42 people so far')).toBeTruthy()
  expect(screen.queryByText('Check the data')).toBeNull()
  expect(within(screen.getByText('Trouble').closest('article')!).getByText('Needs attention')).toBeTruthy()
  const archived = container.querySelector('details')!
  expect(archived.open).toBe(false)
  expect(archived.querySelector('summary')?.textContent).toBe('Archived1›')
  const trouble = screen.getByText('Trouble').closest('article')!
  expect(within(trouble).getByRole('link', { name: 'View results' }).getAttribute('href')).toBe('/admin/experiments/a/results')
  const draft = screen.getByText('Ready draft').closest('article')!
  expect(within(draft).getByRole('link', { name: 'Continue setup' }).getAttribute('href')).toBe('/admin/experiments/c')
  expect(fetch.mock.calls[1]?.[0]).toBe('/api/xp/experiments/summary?ids=a,b,c,d,e,f')
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'HEALTHY' } })
  expect(screen.queryByText('Trouble')).toBeNull()
  expect(screen.getByText('Healthy')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing' } })
  expect(screen.getByText('No tests match "nothing".')).toBeTruthy()
  expect(screen.queryByRole('region')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(screen.getByRole('searchbox').getAttribute('value')).toBe('')
  expect(screen.getByText('Trouble')).toBeTruthy()
})
test('list failure offers a retry', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(JSON.stringify({ docs: [] })))
  vi.stubGlobal('fetch', fetch)
  render(<TestsHome adminRoute="/admin" apiRoute="/api" canManage />)
  expect((await screen.findByRole('alert')).textContent).toContain('Tests could not be loaded.')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('Create a test to learn what works.')
  expect(fetch).toHaveBeenCalledTimes(2)
})
test('a failed summary keeps the cards and explains the missing summaries', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('summary?') ? new Response('{}', { status: 503 })
    : new Response(JSON.stringify({ docs: [{ id: '1', name: 'My test', kind: 'flag', status: 'draft' }] }))))
  render(<TestsHome adminRoute="/admin" apiRoute="/api" canManage />)
  await screen.findByText('My test')
  expect(screen.getByRole('alert').textContent).toContain('Some test summaries could not be loaded.')
})
test('summary requests batch at 100 ids', async () => {
  const docs = Array.from({ length: 101 }, (_, index) => ({ id: String(index), name: `Test ${index}`, kind: 'flag', status: 'draft' }))
  const fetch = fetchData(docs)
  render(<TestsHome adminRoute="/admin" apiRoute="/api" canManage />)
  await screen.findByText('Test 100')
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
  expect(fetch.mock.calls[2]?.[0]).toBe('/api/xp/experiments/summary?ids=100')
})
test('list 403 renders the load-error alert', async () => {
  const fetch = vi.fn(async () => new Response('{}', { status: 403 }))
  vi.stubGlobal('fetch', fetch)
  render(<TestsHome adminRoute="/admin" apiRoute="/api" canManage />)
  expect((await screen.findByRole('alert')).textContent).toContain('Tests could not be loaded.')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(fetch).toHaveBeenCalledOnce()
})
test('250 tests across three pages all render, retaining order and summary batching', async () => {
  const docs = Array.from({ length: 250 }, (_, index) => ({ id: String(index), name: `Test ${index}`, kind: 'flag', status: 'draft' }))
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/summary?')) return new Response('{}')
    const page = Number(new URL(url, 'https://example.test').searchParams.get('page'))
    return new Response(JSON.stringify({ docs: docs.slice((page - 1) * 100, page * 100), hasNextPage: page < 3 }))
  })
  vi.stubGlobal('fetch', fetch)
  render(<TestsHome adminRoute="/admin" apiRoute="/api" canManage />)
  await screen.findByText('Test 249')
  expect(screen.getAllByRole('article')).toHaveLength(250)
  expect(screen.getAllByRole('article').map(row => row.querySelector('a')?.textContent)).toEqual(docs.map(doc => doc.name))
  expect(fetch).toHaveBeenCalledTimes(6)
  expect(fetch.mock.calls.slice(0, 3).map(([url]) => new URL(url, 'https://example.test').searchParams.get('page'))).toEqual(['1', '2', '3'])
  expect(screen.queryByText('Showing the 200 most recent tests.')).toBeNull()
})
test('missing results never render a green health dot', async () => {
  fetchData([
    { id: 'missing', name: 'Missing summary', kind: 'flag', status: 'running' },
    { id: 'null', name: 'No verdict', kind: 'flag', status: 'running' },
  ], { null: { exposures: 0, days: 0, verdict: null } })
  const { container } = render(<TestsHome adminRoute="/admin" apiRoute="/api" canManage />)
  await screen.findByText('Missing summary')
  expect(container.querySelector('.xp-tests-health')).toBeNull()
  expect(screen.queryByText('On track')).toBeNull()
  expect(within(screen.getByRole('region', { name: 'Running' })).getAllByRole('article')).toHaveLength(2)
})
test('home and shell links support the root admin route', async () => {
  fetchData([{ id: '123', name: 'Stopped test', kind: 'flag', status: 'stopped' }])
  const props: TestsSurfaceProps = { route: 'home', adminRoute: '/', apiRoute: '/api', canManage: true, canReadResults: true, isAdmin: false, flagPoints: [], metricSources: [], attributeKeys: {} }
  render(<TestsSurface {...props} />)
  await screen.findByText('Stopped test')
  expect(screen.getByRole('heading', { level: 1, name: 'Tests' })).toBeTruthy()
  for (const [name, href] of [['Back to admin', '/'], ['New test', '/experiments/new'], ['Goals', '/experiments/goals'], ['View results', '/experiments/123/results']]) {
    expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(href)
  }
})

test('empty groups are hidden and Goals is hidden for non-managers', async () => {
  fetchData([{ id: 'one', name: 'Only draft', kind: 'flag', status: 'draft' }])
  render(<TestsHome adminRoute="/control" apiRoute="/api" canManage={false} />)
  await screen.findByText('Only draft')
  expect(screen.getAllByRole('region').map(region => region.getAttribute('aria-labelledby'))).toEqual(['xp-tests-group-3'])
  expect(screen.queryByRole('link', { name: 'Goals' })).toBeNull()
  expect(screen.queryByText('Archived')).toBeNull()
  expect(screen.getByRole('searchbox', { name: 'Search tests' })).toBeTruthy()
})
test('compact rows show all health labels, sentences and custom-route links', async () => {
  fetchData([
    { id: 'red', name: 'Data trouble', kind: 'block', status: 'running', analysis: { plannedDurationDays: 28 } },
    { id: 'amber', name: 'Past end', kind: 'flag', status: 'running', analysis: { plannedDurationDays: 28 } },
    { id: 'green', name: 'Healthy test', kind: 'flag', status: 'running', analysis: { plannedDurationDays: 28 } },
    { id: 'ready', name: 'Ready test', kind: 'flag', status: 'draft' },
    { id: 'next', name: 'Setup test', kind: 'flag', status: 'draft' },
    { id: 'decided', name: 'Decided test', kind: 'flag', status: 'decided', decidedAt: '2026-10-12T23:30:00Z', arms: [{ key: 'variantA', label: 'Short form' }], decision: { winnerArm: 'variantA' } },
    { id: 'old', name: 'Archived test', kind: 'flag', status: 'archived' },
  ], {
    red: { days: 2, exposures: 30, verdict: { code: 'data-problem', headline: 'Extra verdict' } },
    amber: { days: 31, exposures: 2940, verdict: { code: 'collecting', headline: 'Collecting detail' } },
    green: { days: 9, exposures: 1204, verdict: { code: 'collecting', headline: 'Collecting detail' } },
    ready: { ready: true },
  })
  const { container } = render(<TestsHome adminRoute="/control" apiRoute="/api" canManage />)
  await screen.findByText('Data trouble')
  for (const [name, health] of [['Data trouble', 'Needs attention'], ['Past end', 'Check data'], ['Healthy test', 'On track']] as const) {
    expect(within(screen.getByRole('link', { name }).closest('article')!).getByText(health)).toBeTruthy()
  }
  expect(screen.getByText('Running 31 days of 28 · 2,940 people so far')).toBeTruthy()
  expect(screen.getByText('Running 9 days of 28 · 1,204 people so far')).toBeTruthy()
  expect(screen.queryByText('Collecting detail')).toBeNull()
  expect(screen.getByText('Decided 12 Oct 2026: Short form')).toBeTruthy()
  expect(screen.getByText('Next: Review setup')).toBeTruthy()
  for (const [name, id, action, suffix] of [
    ['Data trouble', 'red', 'View results', '/results'], ['Ready test', 'ready', 'Continue setup', ''],
    ['Setup test', 'next', 'Continue setup', ''], ['Decided test', 'decided', 'View results', '/results'],
    ['Archived test', 'old', 'View results', '/results'],
  ] as const) {
    const link = screen.getByText(name).closest('a')!
    expect(link.getAttribute('href')).toBe(`/control/experiments/${id}${suffix}`)
    expect(within(link.closest('article')!).getByText(action).getAttribute('href')).toBe(link.getAttribute('href'))
  }
  expect(container.querySelector('details')!.open).toBe(false)
  expect(screen.getByRole('link', { name: 'Goals' }).getAttribute('href')).toBe('/control/experiments/goals')
})

test('home renders shared readiness sentences, context and safe fallback copy', async () => {
  const secret = 'pg: password=hunter2'
  const rows = [
    ['goal', 'draft', 'no-primary-metric', { message: secret }, 'Next: Choose a goal.'],
    ['placement', 'stopped', 'no-placements', secret, 'Next: Not on a page yet. Open a page, add an Experiment block and choose this test.'],
    ['length', 'draft', 'no-planned-duration', secret, 'Next: Choose how long to run it.'],
    ['versions', 'draft', 'weights-total', { message: secret }, 'Next: Fix the versions: check the group settings.'],
    ['raw-versions', 'draft', 'weights-total', secret, 'Next: Fix the versions: check the group settings.'],
    ['unknown', 'draft', 'future-check', secret, 'Next: Review setup'],
    ['missing', 'stopped', undefined, undefined, 'Next: Review setup'],
    ['parameter', 'draft', 'flag-params-invalid', [{ arm: 'variantA', field: 'show' }], 'Next: Set a value for Show the form on Short form.'],
    ['people', 'stopped', 'unit-source-mismatch', undefined, "Next: This goal can't be measured for signed-in users. Choose another goal."],
  ] as const
  fetchData(rows.map(([id, status]) => ({ id, name: id, status, kind: 'flag', unitType: 'user', flagPoint: 'form',
    arms: [{ key: 'variantA', label: 'Short form', kind: 'variant', weight: 50 }] })),
  Object.fromEntries(rows.map(([id, , code, detail]) => [id, { ready: false, ...(code ? { next: { code, detail } } : {}) }])))
  const props: TestsSurfaceProps = { route: 'home', adminRoute: '/admin', apiRoute: '/api', canManage: true, canReadResults: true,
    isAdmin: false, metricSources: [], attributeKeys: {},
    flagPoints: [{ id: 'form', label: 'Form', params: { show: { type: 'checkbox', label: 'Show the form' } }, defaultParams: { show: true }, effectiveDefaults: { show: true } }] }
  const { container } = render(<TestsSurface {...props} />)
  await screen.findByText('goal')
  for (const [id, , , , sentence] of rows) {
    expect(within(screen.getByRole('link', { name: id }).closest('article')!).getByText(sentence)).toBeTruthy()
  }
  expect(container.textContent).not.toContain(secret)
  expect(container.textContent).not.toContain('future-check')
  expect(container.textContent).not.toContain('finish setting up')
})

test('stable paging renders a repeated test once and keeps newest activity first within groups', async () => {
  const older = { id: 'a', name: 'Older draft', kind: 'flag', status: 'draft', updatedAt: '2026-11-01T00:00:00Z' }
  const newest = { id: 'b', name: 'Newest draft', kind: 'flag', status: 'draft', updatedAt: '2026-11-03T00:00:00Z' }
  const middle = { id: 'c', name: 'Middle draft', kind: 'flag', status: 'draft', updatedAt: '2026-11-02T00:00:00Z' }
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/summary?')) return new Response('{}')
    const params = new URL(url, 'https://example.test').searchParams
    expect(params.get('sort')).toBe('id')
    const first = params.get('page') === '1'
    return new Response(JSON.stringify({ docs: first ? [older, newest] : [{ ...older, name: 'Repeated draft' }, middle], hasNextPage: first }))
  })
  vi.stubGlobal('fetch', fetch)
  render(<TestsHome adminRoute="/admin" apiRoute="/api" canManage />)
  await screen.findByText('Middle draft')
  expect(screen.getAllByRole('article').map(row => row.querySelector('a')?.textContent)).toEqual(['Newest draft', 'Middle draft', 'Older draft'])
  expect(screen.queryByText('Repeated draft')).toBeNull()
  expect(fetch.mock.calls[2]?.[0]).toBe('/api/xp/experiments/summary?ids=b,c,a')
})

// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { SurfaceProps } from '../../../src/admin/surface/contracts.js'
import { GoalForm } from '../../../src/admin/surface/goals/GoalForm.js'
import { GoalsList } from '../../../src/admin/surface/goals/GoalsList.js'
import { TestsSurface } from '../../../src/admin/surface/TestsSurface.js'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation.js', () => ({ useRouter: () => ({ push }) }))
vi.mock('@payloadcms/ui', () => ({ Link: (props: ComponentProps<'a'>) => <a {...props} />, Pill: ({ children }: ComponentProps<'span'>) => <span>{children}</span> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const surface: SurfaceProps = { adminRoute: '/control', apiRoute: '/data/', canManage: true, canReadResults: true, isAdmin: false,
  flagPoints: [], attributeKeys: {}, metricSources: [
    { id: 'signup', label: 'Registrations', kind: 'binomial', keyedBy: 'visitor', clientWritable: true },
    { id: 'gift', label: 'Gift amounts', kind: 'revenue', keyedBy: 'user', clientWritable: false },
  ] }
const goal = { id: 7, name: 'Register', slug: 'register', source: 'signup', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150, guardrailThreshold: 0.05 }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function fill(name = 'Completed registrations') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Measured by'), { target: { value: 'signup' } })
}
async function loadForm(tests: unknown[] = [], loaded = goal) {
  const fetch = vi.fn(async (url: string) => response(url.includes('/xp-experiments?') ? { docs: tests } : loaded))
  vi.stubGlobal('fetch', fetch)
  render(<GoalForm surface={surface} id="7" />)
  await screen.findByLabelText('Name')
  return fetch
}
test('list pages through goals and tests and renders source labels, directions, distinct usage and status', async () => {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const next = url.endsWith('page=2')
    if (url.includes('xp-metrics')) return response({ docs: next ? [{ ...goal, id: 'other', name: 'Give', source: 'gift', direction: 'decrease' }] : [goal], hasNextPage: !next })
    return response({ docs: next ? [{ id: 'two', metrics: { secondary: [7] } }] : [{ id: 'one', metrics: { primary: 7, guardrails: [7] } }], hasNextPage: !next })
  })
  vi.stubGlobal('fetch', fetch)
  render(<GoalsList surface={surface} returnToTest="test/1" />)
  const row = (await screen.findByRole('link', { name: 'Register' })).closest('tr')!
  expect(within(row).getByText('Registrations')).toBeTruthy()
  expect(within(row).getByText('Goes up')).toBeTruthy()
  expect(within(row).getByText('2')).toBeTruthy()
  expect(within(row).getByText('In use')).toBeTruthy()
  const unused = screen.getByRole('link', { name: 'Give' }).closest('tr')!
  expect(within(unused).getByText('Goes down')).toBeTruthy()
  expect(within(unused).getByText('0')).toBeTruthy()
  expect(within(unused).getByText('Not used')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'New goal' }).getAttribute('href')).toBe('/control/experiments/goals/new?return=test%2F1')
  expect(screen.getByRole('link', { name: 'Register' }).getAttribute('href')).toBe('/control/experiments/goals/7?return=test%2F1')
  expect(fetch).toHaveBeenCalledTimes(4)
  for (const call of fetch.mock.calls) expect(call[1]).toMatchObject({ credentials: 'include' })
})
test('empty goals explain their purpose and keep New goal available', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ docs: [] })))
  render(<GoalsList surface={surface} />)
  expect(await screen.findByText('A goal is an outcome you want a test to improve, such as a registration or a gift.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'New goal' })).toBeTruthy()
})
test('new goal derives an editable short name and posts only collection fields, converting percent to fraction', async () => {
  const fetch = vi.fn(async () => response({ doc: { ...goal, id: 'goal-uuid' } }))
  vi.stubGlobal('fetch', fetch)
  render(<GoalForm surface={surface} returnToTest="test/1" />)
  await screen.findByLabelText('Name')
  fill()
  expect((screen.getByLabelText('Short name') as HTMLInputElement).value).toBe('completed-registrations')
  fireEvent.change(screen.getByLabelText('Short name'), { target: { value: 'my-goal' } })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New title' } })
  expect((screen.getByLabelText('Short name') as HTMLInputElement).value).toBe('my-goal')
  fireEvent.change(screen.getByLabelText('Warn when it gets worse by (%)'), { target: { value: '8' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/control/experiments/test%2F1?goal=goal-uuid'))
  expect(fetch).toHaveBeenCalledWith('/data/xp-metrics', expect.objectContaining({ method: 'POST', credentials: 'include' }))
  const request = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(request[1].body as string)).toEqual({ name: 'New title', slug: 'my-goal', source: 'signup', direction: 'increase',
    attributionWindowHours: 168, minSampleSize: 150, capping: { type: null, value: null }, guardrailThreshold: 0.08 })
})
test('revenue defaults and shared capping validation match the collection', async () => {
  const fetch = vi.fn(async () => response({ doc: goal }))
  vi.stubGlobal('fetch', fetch)
  render(<GoalForm surface={surface} />)
  await screen.findByLabelText('Name')
  fill('Gifts')
  fireEvent.change(screen.getByLabelText('Measured by'), { target: { value: 'gift' } })
  expect(screen.queryByRole('option', { name: 'No limit' })).toBeNull()
  expect((screen.getByLabelText('Limit by') as HTMLSelectElement).value).toBe('percentile')
  expect((screen.getByLabelText('Limit value') as HTMLInputElement).value).toBe('0.99')
  fireEvent.change(screen.getByLabelText('Limit value'), { target: { value: '2' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
  expect(screen.getByRole('alert').textContent).toBe('Enter a valid limit (for past amounts, use a number greater than 0 and at most 1).')
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Limit by'), { target: { value: 'absolute' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/control/experiments/goals'))
  const request = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(request[1].body as string).capping).toEqual({ type: 'absolute', value: 2 })
})
test('existing revenue goals without a cap show the same default the server applies on save', async () => {
  await loadForm([], { ...goal, source: 'gift' })
  expect((screen.getByLabelText('Limit by') as HTMLSelectElement).value).toBe('percentile')
  expect((screen.getByLabelText('Limit value') as HTMLInputElement).value).toBe('0.99')
  expect(screen.queryByRole('option', { name: 'No limit' })).toBeNull()
})
test('a used goal locks its short name and disables Delete with its usage count', async () => {
  const fetch = await loadForm([{ id: 1, metrics: { secondary: [7], primary: 7 } }, { id: 2, metrics: { guardrails: [7] } }])
  expect((screen.getByLabelText('Short name') as HTMLInputElement).readOnly).toBe(true)
  expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Used by 2 tests')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('navigation').textContent).toBe('Tests›Goals›Register')
})
test('usage on later pages also locks the short name', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(!url.includes('/xp-experiments?') ? goal : url.endsWith('page=1')
    ? { docs: [], hasNextPage: true } : { docs: [{ id: 1, metrics: { primary: 7 } }] })))
  render(<GoalForm surface={surface} id="7" />)
  expect((await screen.findByLabelText('Short name') as HTMLInputElement).readOnly).toBe(true)
})
test('an unused goal can be edited and deleted through REST', async () => {
  const fetch = await loadForm()
  expect((screen.getByLabelText('Short name') as HTMLInputElement).readOnly).toBe(false)
  fetch.mockResolvedValueOnce(response({ doc: goal }))
  fireEvent.change(screen.getByLabelText('Short name'), { target: { value: 'updated' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/control/experiments/goals'))
  expect(fetch).toHaveBeenLastCalledWith('/data/xp-metrics/7', expect.objectContaining({ method: 'PATCH', credentials: 'include', body: expect.stringContaining('"slug":"updated"') }))
})
test('delete sends credentials and returns to the list', async () => {
  const fetch = await loadForm()
  fetch.mockResolvedValueOnce(response(goal))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/control/experiments/goals'))
  expect(fetch).toHaveBeenLastCalledWith('/data/xp-metrics/7', { method: 'DELETE', credentials: 'include' })
})
test.each(['save', 'delete', 'load'] as const)('server %s refusals display the server message', async operation => {
  const denial = { errors: [{ message: 'You may not change goals.' }] }
  let fetch
  if (operation === 'load') {
    fetch = vi.fn(async () => response(denial, 403)); vi.stubGlobal('fetch', fetch)
    render(<GoalsList surface={surface} />)
  } else {
    fetch = await loadForm()
    fetch.mockResolvedValueOnce(response(denial, 403))
    fireEvent.click(screen.getByRole('button', { name: operation === 'save' ? 'Save' : 'Delete' }))
  }
  expect((await screen.findByRole('alert')).textContent).toContain('You may not change goals.')
  expect(push).not.toHaveBeenCalled()
})
test('pending submit prevents a duplicate POST and disables Cancel', async () => {
  const fetch = vi.fn(() => new Promise(() => {}))
  vi.stubGlobal('fetch', fetch)
  render(<GoalForm surface={surface} />)
  await screen.findByLabelText('Name'); fill()
  const form = screen.getByRole('button', { name: 'Save' }).closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(fetch).toHaveBeenCalledOnce()
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
})
test('surface dispatches goals and form routes with sources and the shared shell', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/7?') ? goal : { docs: [] })))
  const view = render(<TestsSurface {...surface} route="goals" />)
  await screen.findByText('A goal is an outcome you want a test to improve, such as a registration or a gift.')
  expect(screen.getAllByRole('link', { name: 'Tests' })).toHaveLength(2)
  view.rerender(<TestsSurface {...surface} route="goalNew" returnToTest="abc" />)
  await screen.findByLabelText('Name')
  expect(screen.getByRole('option', { name: 'Registrations · yes/no' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(push).toHaveBeenLastCalledWith('/control/experiments/goals?return=abc')
  view.rerender(<TestsSurface {...surface} route="goal" id="7" />)
  await screen.findByDisplayValue('Register')
})

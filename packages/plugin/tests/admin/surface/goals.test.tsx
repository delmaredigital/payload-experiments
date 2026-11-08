// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SurfaceProps } from '../../../src/admin/surface/contracts.js'
import { GoalForm } from '../../../src/admin/surface/goals/GoalForm.js'
import { GoalsList } from '../../../src/admin/surface/goals/GoalsList.js'
import { TestsSurface } from '../../../src/admin/surface/TestsSurface.js'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation.js', () => ({ useRouter: () => ({ push }) }))
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const surface: SurfaceProps = { adminRoute: '/control', apiRoute: '/data/', canManage: true, canReadResults: true, isAdmin: false,
  flagPoints: [], attributeKeys: {}, metricSources: [
    { id: 'signup', label: 'Registrations', kind: 'binomial', keyedBy: 'visitor', clientWritable: true },
    { id: 'gift', label: 'Gift amounts', kind: 'revenue', keyedBy: 'user', clientWritable: false },
  ] }
const goal = { id: 7, name: 'Register', slug: 'register', source: 'signup', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150, guardrailThreshold: 0.05 }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function shellHeader() {
  const header = screen.getByRole('heading', { level: 1 }).closest<HTMLElement>('header.xp-tests-shell-header')
  expect(header).not.toBeNull()
  return header!
}
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
test('list pages through goals and tests and renders compact rows, kinds, directions and distinct usage', async () => {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const next = url.endsWith('page=2')
    if (url.includes('xp-metrics')) return response({ docs: next ? [{ ...goal, id: 'other', name: 'Give', source: 'gift', direction: 'decrease' }] : [goal], hasNextPage: !next })
    return response({ docs: next ? [{ id: 'two', metrics: { secondary: [7] } }] : [{ id: 'one', metrics: { primary: 7, guardrails: [7] } }], hasNextPage: !next })
  })
  vi.stubGlobal('fetch', fetch)
  render(<GoalsList surface={surface} returnToTest="test/1" />)
  const row = (await screen.findByRole('link', { name: 'Register' })).closest('article')!
  expect(within(row).getByRole('link', { name: 'Register' }).tagName).toBe('A')
  expect(within(row).getByText('Yes/no')).toBeTruthy()
  expect(within(row).getByText('More is better')).toBeTruthy()
  expect(within(row).getByText('Used by 2 tests')).toBeTruthy()
  const unused = screen.getByRole('link', { name: 'Give' }).closest('article')!
  expect(within(unused).getByText('Less is better')).toBeTruthy()
  expect(within(unused).getByText('Amount')).toBeTruthy()
  expect(within(unused).getByText('Not used yet')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'New goal' }).getAttribute('href')).toBe('/control/experiments/goals/new?return=test%2F1')
  expect(screen.getByRole('link', { name: 'Register' }).getAttribute('href')).toBe('/control/experiments/goals/7?return=test%2F1')
  expect(screen.getByRole('link', { name: 'Back to the test' }).getAttribute('href')).toBe('/control/experiments/test%2F1')
  const action = within(row).getByRole('link', { name: 'Use this goal' })
  expect(action.getAttribute('href')).toBe('/control/experiments/test%2F1?goal=7')
  expect(action.classList.contains('xp-ui-button--primary')).toBe(true)
  expect(shellHeader().contains(screen.getByRole('link', { name: 'New goal' }))).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(4)
  for (const call of fetch.mock.calls) expect(call[1]).toMatchObject({ credentials: 'include' })
})
test('empty goals explain their purpose and keep New goal available', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ docs: [] })))
  render(<GoalsList surface={surface} />)
  expect(await screen.findByText('No goals yet. A goal is what a test tries to improve.')).toBeTruthy()
  expect(screen.getAllByRole('link', { name: 'New goal' })).toHaveLength(2)
})
test('Use this goal encodes the test path and goal query under the configured admin route', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response({ docs: url.includes('xp-metrics') ? [{ ...goal, id: 'goal/with & symbols' }] : [] })))
  render(<GoalsList surface={{ ...surface, adminRoute: '/' }} returnToTest="test/1" />)
  expect((await screen.findByRole('link', { name: 'Use this goal' })).getAttribute('href')).toBe('/experiments/test%2F1?goal=goal%2Fwith+%26+symbols')
})
test('the single goal form has a plain card without section progress', async () => {
  await loadForm()
  const card = screen.getByRole('heading', { level: 2, name: 'Goal details' }).closest('.xp-ui-card')!
  expect(card).not.toBeNull()
  expect(card.classList.contains('xp-ui-section')).toBe(false)
  expect(card.querySelector('.xp-ui-section-number, .xp-ui-section-complete')).toBeNull()
  expect(screen.queryByLabelText('Incomplete')).toBeNull()
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
  expect(screen.getByLabelText('Limit value').getAttribute('aria-invalid')).toBe('true')
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Limit by'), { target: { value: 'absolute' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/control/collections/xp-metrics'))
  const request = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(request[1].body as string).capping).toEqual({ type: 'absolute', value: 2 })
})
test('existing revenue goals without a cap show the same default the server applies on save', async () => {
  await loadForm([], { ...goal, source: 'gift' })
  expect((screen.getByLabelText('Limit by') as HTMLSelectElement).value).toBe('percentile')
  expect((screen.getByLabelText('Limit value') as HTMLInputElement).value).toBe('0.99')
  expect(screen.queryByRole('option', { name: 'No limit' })).toBeNull()
})
test.each([[0.07, '7'], [0.29, '29']] as const)('threshold %s displays as %s without float noise', async (guardrailThreshold, display) => {
  await loadForm([], { ...goal, guardrailThreshold })
  expect((screen.getByLabelText('Warn when it gets worse by (%)') as HTMLInputElement).value).toBe(display)
})
test('threshold can be cleared and saves the default', async () => {
  const fetch = await loadForm([], { ...goal, guardrailThreshold: 0.29 })
  const input = screen.getByLabelText('Warn when it gets worse by (%)') as HTMLInputElement
  fireEvent.change(input, { target: { value: '' } })
  expect(input.value).toBe('')
  fetch.mockResolvedValueOnce(response({ doc: goal }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(push).toHaveBeenCalledOnce())
  expect(fetch).toHaveBeenLastCalledWith('/data/xp-metrics/7', expect.objectContaining({ body: expect.stringContaining('"guardrailThreshold":0.05') }))
})
test('invalid threshold opens Advanced and shows an associated field error without saving', async () => {
  const fetch = await loadForm()
  const input = screen.getByLabelText('Warn when it gets worse by (%)')
  const advanced = input.closest('details')!
  expect(advanced.open).toBe(false)
  fireEvent.change(input, { target: { value: '-1' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
  const error = screen.getByRole('alert')
  expect(error.textContent).toBe('Enter a percentage of zero or more, or leave blank for 5%.')
  expect(advanced.open).toBe(true)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toBe(error.id)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(push).not.toHaveBeenCalled()
})
test('existing goal keeps a linked Goals crumb and a generic Goal title while loading and on failure', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
  render(<TestsSurface {...surface} route="goal" id="7" />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Goal')
  const crumbs = within(shellHeader()).getByRole('navigation')
  expect(crumbs.textContent).toBe('Tests›Goals›Goal')
  expect(within(crumbs).getByRole('link', { name: 'Goals' }).getAttribute('href')).toBe('/control/collections/xp-metrics')
  finish(response({ errors: [{ message: 'Unable to load this goal.' }] }, 500))
  await screen.findByRole('alert')
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Goal')
  expect(screen.queryByText('New goal')).toBeNull()
})
test('a used goal locks its short name and disables Delete with its usage count', async () => {
  const fetch = await loadForm([{ id: 1, metrics: { secondary: [7], primary: 7 } }, { id: 2, metrics: { guardrails: [7] } }])
  expect((screen.getByLabelText('Short name') as HTMLInputElement).readOnly).toBe(true)
  // The server refuses a source change on a used goal (CORE-29), so the form never offers one.
  expect((screen.getByLabelText('Measured by') as HTMLSelectElement).disabled).toBe(true)
  expect(screen.getByText('What this goal measures stays the same once a test uses it.')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Delete goal' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Used by 2 tests. Remove it from those tests first.')).toBeTruthy()
  expect(within(shellHeader()).getByText('In use by 2 tests')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Delete goal' }).getAttribute('aria-describedby')).toBe('xp-goal-used')
  fireEvent.click(screen.getByRole('button', { name: 'Delete goal' }))
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('navigation').textContent).toBe('Tests›Goals›Register')
})
test('usage on later pages also locks the short name', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(!url.includes('/xp-experiments?') ? goal : url.endsWith('page=1')
    ? { docs: [{ id: 2, metrics: {} }], hasNextPage: true } : { docs: [{ id: 1, metrics: { primary: 7 } }] })))
  render(<GoalForm surface={surface} id="7" />)
  expect((await screen.findByLabelText('Short name') as HTMLInputElement).readOnly).toBe(true)
  expect(screen.getByText('Used by 1 test. Remove it from those tests first.')).toBeTruthy()
})
test('an unused goal can be edited and deleted through REST', async () => {
  const fetch = await loadForm()
  expect((screen.getByLabelText('Short name') as HTMLInputElement).readOnly).toBe(false)
  fetch.mockResolvedValueOnce(response({ doc: goal }))
  fireEvent.change(screen.getByLabelText('Short name'), { target: { value: 'updated' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/control/collections/xp-metrics'))
  expect(fetch).toHaveBeenLastCalledWith('/data/xp-metrics/7', expect.objectContaining({ method: 'PATCH', credentials: 'include', body: expect.stringContaining('"slug":"updated"') }))
})
test('delete asks first, focuses Cancel, closes on Cancel and Escape, then sends credentials exactly once', async () => {
  const fetch = await loadForm()
  const trigger = screen.getByRole('button', { name: 'Delete goal' })
  fireEvent.click(trigger)
  let dialog = screen.getByRole('dialog', { name: 'Delete this goal?' })
  expect(within(dialog).getByText('This cannot be undone.')).toBeTruthy()
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(fetch).toHaveBeenCalledTimes(2)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(2)
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(fetch).toHaveBeenCalledTimes(2)
  fetch.mockResolvedValueOnce(response(goal))
  fireEvent.click(trigger)
  dialog = screen.getByRole('dialog')
  const confirm = within(dialog).getByRole('button', { name: 'Delete' })
  act(() => { confirm.click(); confirm.click() })
  await waitFor(() => expect(push).toHaveBeenCalledWith('/control/collections/xp-metrics'))
  expect(fetch).toHaveBeenLastCalledWith('/data/xp-metrics/7', { method: 'DELETE', credentials: 'include' })
  expect(fetch).toHaveBeenCalledTimes(3)
})
test.each(['save', 'delete', 'load'] as const)('server %s refusals display the mapped permission message', async operation => {
  const denial = { errors: [{ message: 'You may not change goals.' }] }
  let fetch
  if (operation === 'load') {
    fetch = vi.fn(async () => response(denial, 403)); vi.stubGlobal('fetch', fetch)
    render(<GoalsList surface={surface} />)
  } else {
    fetch = await loadForm()
    fetch.mockResolvedValueOnce(response(denial, 403))
    fireEvent.click(screen.getByRole('button', { name: operation === 'save' ? 'Save' : 'Delete goal' }))
    if (operation === 'delete') fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
  }
  expect((await screen.findByRole('alert')).textContent).toContain("You don't have permission to do this.")
  expect(push).not.toHaveBeenCalled()
})
test('pending submit prevents a duplicate POST and Cancel remains a navigation link', async () => {
  const fetch = vi.fn(() => new Promise(() => {}))
  vi.stubGlobal('fetch', fetch)
  render(<GoalForm surface={surface} />)
  await screen.findByLabelText('Name'); fill()
  const form = screen.getByRole('button', { name: 'Save' }).closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(fetch).toHaveBeenCalledOnce()
  expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/control/collections/xp-metrics')
})
test('surface dispatches goals and form routes with sources and the shared shell', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/7?') ? goal : { docs: [] })))
  function expectShell(labels: string[]) {
    expect(screen.getAllByRole('navigation', { name: 'Breadcrumb' })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    const main = screen.getByRole('main')
    expect(main.classList.contains('xp-tests-main')).toBe(true)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(labels[labels.length - 1])
    const crumbs = within(shellHeader()).getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getAllByRole('listitem').map(item => item.textContent?.replace('›', ''))).toEqual(labels)
    expect(within(crumbs).getByText(labels[labels.length - 1]!).getAttribute('aria-current')).toBe('page')
    expect(within(crumbs).getByRole('link', { name: 'Tests' }).getAttribute('href')).toBe('/control/collections/xp-experiments')
    expect(screen.getByRole('link', { name: 'Back to admin' }).getAttribute('href')).toBe('/control')
    return crumbs
  }
  const view = render(<TestsSurface {...surface} route="goals" />)
  await screen.findByText('No goals yet. A goal is what a test tries to improve.')
  expect(screen.getAllByRole('link', { name: 'Tests' })).toHaveLength(1)
  expectShell(['Tests', 'Goals'])
  view.rerender(<TestsSurface {...surface} route="goalNew" returnToTest="abc" />)
  await screen.findByLabelText('Name')
  const crumbs = expectShell(['Tests', 'Goals', 'New goal'])
  expect(within(crumbs).getByRole('link', { name: 'Goals' }).getAttribute('href')).toBe('/control/collections/xp-metrics?return=abc')
  expect(screen.getByRole('option', { name: 'Registrations · yes/no' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/control/collections/xp-metrics?return=abc')
  view.rerender(<TestsSurface {...surface} route="goal" id="7" />)
  await screen.findByDisplayValue('Register')
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Register'))
  const editCrumbs = expectShell(['Tests', 'Goals', 'Register'])
  expect(within(editCrumbs).getByRole('link', { name: 'Goals' }).getAttribute('href')).toBe('/control/collections/xp-metrics')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved edit' } })
  view.rerender(<TestsSurface {...surface} route="goalNew" />)
  await screen.findByLabelText('Name')
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('')
  expect(screen.queryByRole('button', { name: 'Delete goal' })).toBeNull()
})


test('kind chips cover count and omit missing or unknown source kinds; normal rows offer Open', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response({ docs: url.includes('xp-metrics') ? [
    { ...goal, id: 1, source: 'visits' }, { ...goal, id: 2, name: 'Missing', source: 'gone' },
    { ...goal, id: 3, name: 'Unknown', source: 'unknown' },
  ] : [] })))
  const sources = [...surface.metricSources, { id: 'visits', label: 'Visits', kind: 'count' as const, keyedBy: 'visitor' as const, clientWritable: true },
    { id: 'unknown', label: 'Unknown', kind: 'future' as 'count', keyedBy: 'visitor' as const, clientWritable: true }]
  render(<GoalsList surface={{ ...surface, metricSources: sources }} />)
  const row = (await screen.findByRole('link', { name: 'Register' })).closest('article')!
  expect(within(row).getByText('Count').classList.contains('xp-tests-kind')).toBe(true)
  expect(within(row).getByRole('link', { name: 'Open' }).classList.contains('xp-ui-button--secondary')).toBe(true)
  for (const name of ['Missing', 'Unknown']) expect(screen.getByRole('link', { name }).closest('article')!.querySelector('.xp-tests-kind')).toBeNull()
  expect(screen.queryByRole('searchbox')).toBeNull()
})

test.each([8, 9])('search is present only above eight goals (%s), filters by name and can clear no matches', async count => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response({ docs: url.includes('xp-metrics')
    ? Array.from({ length: count }, (_, id) => ({ ...goal, id, name: `Goal ${id}` })) : [] })))
  render(<GoalsList surface={surface} />)
  await screen.findByRole('link', { name: 'Goal 0' })
  if (count === 8) { expect(screen.queryByRole('searchbox')).toBeNull(); return }
  const search = screen.getByRole('searchbox', { name: 'Search goals' })
  fireEvent.change(search, { target: { value: '  GOAL 1 ' } })
  expect(screen.getByRole('link', { name: 'Goal 1' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Goal 0' })).toBeNull()
  fireEvent.change(search, { target: { value: 'newsletter' } })
  expect(screen.getByText('No goals match “newsletter”.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.getByRole('link', { name: 'Goal 0' })).toBeTruthy()
})

test('list shows loading, error Banner and Retry, then recovers', async () => {
  const fetch = vi.fn(async () => response({}, 500))
  vi.stubGlobal('fetch', fetch)
  render(<GoalsList surface={surface} />)
  expect(screen.getByRole('status').textContent).toBe('Loading goals…')
  expect((await screen.findByRole('alert')).classList.contains('xp-ui-banner--error')).toBe(true)
  fetch.mockImplementation(async () => response({ docs: [goal] }))
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('link', { name: 'Register' })).toBeTruthy()
})

test.each(['load', 'save', 'delete'] as const)('a not-found refusal on %s uses the goal sentence', async operation => {
  const denial = response({ errors: [{ code: 'not-found', message: 'Not found' }] }, 404)
  if (operation === 'load') {
    vi.stubGlobal('fetch', vi.fn(async () => denial.clone()))
    render(<GoalForm surface={surface} id="7" />)
  } else {
    const fetch = await loadForm()
    fetch.mockResolvedValueOnce(denial)
    fireEvent.click(screen.getByRole('button', { name: operation === 'save' ? 'Save' : 'Delete goal' }))
    if (operation === 'delete') fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
  }
  expect(within(await screen.findByRole('alert')).getByText('This goal no longer exists.', { selector: 'p', exact: true }).textContent).toBe('This goal no longer exists.')
  expect(screen.queryByText('This test no longer exists.')).toBeNull()
  expect(push).not.toHaveBeenCalled()
})

test('server validation associates main and Advanced fields and opens Advanced', async () => {
  const fetch = await loadForm()
  fetch.mockResolvedValueOnce(response({ errors: [{ data: { errors: [
    { path: 'name', message: 'Choose another name.' }, { path: 'guardrailThreshold', message: 'Choose a smaller threshold.' },
  ] } }] }, 400))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Choose another name.')
  for (const label of ['Name', 'Warn when it gets worse by (%)']) {
    const input = screen.getByLabelText(label)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.getAttribute('role')).toBe('alert')
  }
  expect(screen.getByLabelText('Warn when it gets worse by (%)').closest('details')!.open).toBe(true)
  expect(screen.getAllByRole('alert').some(element => element.classList.contains('xp-ui-banner--error'))).toBe(true)
})

test('goals use plugin primitives and have no Payload controls or raw controls', () => {
  const dir = fileURLToPath(new NodeURL('../../../src/admin/surface/goals/', import.meta.url))
  for (const file of readdirSync(dir).filter(file => /\.tsx$/.test(file))) {
    const source = readFileSync(join(dir, file), 'utf8')
    expect(source).not.toMatch(/<(?:input|select|button)\b/)
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from ['"]@payloadcms\/ui['"]/g)) {
      expect(match[1]!.split(',').map(name => name.trim()).every(name => ['Link', 'useConfig', 'useAuth'].includes(name))).toBe(true)
    }
  }
})

test('all 150 goals render across two pages', async () => {
  const goals = Array.from({ length: 150 }, (_, id) => ({ ...goal, id, name: `Goal ${id}` }))
  const fetch = vi.fn(async (url: string) => {
    const page = Number(new URL(url, 'https://example.test').searchParams.get('page'))
    return response(url.includes('xp-metrics') ? { docs: goals.slice((page - 1) * 100, page * 100), hasNextPage: page < 2 } : { docs: [], hasNextPage: false })
  })
  vi.stubGlobal('fetch', fetch)
  render(<GoalsList surface={surface} />)
  await screen.findByRole('link', { name: 'Goal 149' })
  expect(screen.getAllByRole('article')).toHaveLength(150)
  expect(fetch).toHaveBeenCalledTimes(3)
})

const clickSurface: SurfaceProps = { ...surface, metricSources: [...surface.metricSources,
  { id: 'click:', label: 'A click on the page', kind: 'binomial', keyedBy: 'visitor', clientWritable: true }] }
const slugRule = 'Use 1–64 lowercase letters, numbers, underscores or hyphens, starting with a letter or number.'
const duplicateSlug = 'Another goal already uses this short name. Change it under Advanced.'
async function newClick(name: string) {
  render(<GoalForm surface={clickSurface} />)
  await screen.findByLabelText('Name')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Measured by'), { target: { value: 'click:' } })
}
test('click goals post their derived source and fixed analysis settings, with Short name under Advanced', async () => {
  const fetch = vi.fn(async () => response({ doc: goal }))
  vi.stubGlobal('fetch', fetch)
  await newClick('Hero CTA')
  expect((screen.getByLabelText('Short name') as HTMLInputElement).value).toBe('hero-cta')
  expect(screen.getByLabelText('Short name').closest('details')).toBeTruthy()
  expect(screen.queryByLabelText('Better when it goes')).toBeNull()
  expect(screen.queryByText('Limit very large values')).toBeNull()
  expect((screen.getByLabelText('Measured by') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('A click on the page')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
  expect(body).toMatchObject({ slug: 'hero-cta', source: 'click:hero-cta', direction: 'increase', capping: { type: null, value: null } })
})
test('click short-name prefill caps at 64 and trims the trailing separator', async () => {
  vi.stubGlobal('fetch', vi.fn())
  await newClick(`${'a'.repeat(63)} bbbb`)
  expect((screen.getByLabelText('Short name') as HTMLInputElement).value).toBe('a'.repeat(63))
  fireEvent.change(screen.getByLabelText('Short name'), { target: { value: 'custom' } })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Changed' } })
  expect((screen.getByLabelText('Short name') as HTMLInputElement).value).toBe('custom')
})
test.each(['🚀', 'Hero'])('invalid click slug (%s) opens Advanced with the grammar sentence and sends nothing', async name => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await newClick(name)
  if (name === 'Hero') fireEvent.change(screen.getByLabelText('Short name'), { target: { value: 'BAD KEY' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
  expect(screen.getByText(slugRule)).toBeTruthy()
  expect(screen.getByLabelText('Short name').closest('details')!.open).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
})
test('server slug errors for click: use authored duplicate copy and open Advanced', async () => {
  const fetch = vi.fn(async () => response({ errors: [{ data: { errors: [{ path: 'slug', message: 'Value must be unique' }] } }] }, 400))
  vi.stubGlobal('fetch', fetch)
  render(<GoalForm surface={clickSurface} />)
  await screen.findByLabelText('Name')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hero' } })
  fireEvent.change(screen.getByLabelText('Measured by'), { target: { value: 'click:' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(duplicateSlug)).toBeTruthy()
  expect(document.querySelector('details')!.open).toBe(true)
  expect(screen.queryByText('Value must be unique')).toBeNull()
  fireEvent.change(screen.getByLabelText('Measured by'), { target: { value: 'signup' } })
  expect(screen.queryByText(duplicateSlug)).toBeNull()
  expect(screen.getByLabelText('Short name').getAttribute('aria-invalid')).not.toBe('true')
})
test('server slug errors for signup point at the main Short name field and leave Advanced closed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ errors: [{ data: { errors: [{ path: 'slug', message: 'Value must be unique' }] } }] }, 400)))
  render(<GoalForm surface={clickSurface} />)
  await screen.findByLabelText('Name')
  fill('Hero')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Another goal already uses this short name. Choose another.')).toBeTruthy()
  const shortName = screen.getByLabelText('Short name')
  expect(shortName.getAttribute('aria-invalid')).toBe('true')
  expect(shortName.closest('details')).toBeNull()
  expect(document.querySelector('details')!.open).toBe(false)
  expect(screen.queryByText('Value must be unique')).toBeNull()
})
test('a repeated server slug error reopens Advanced after the click goal disclosure was closed', async () => {
  const duplicateResponse = () => response({ errors: [{ data: { errors: [{ path: 'slug', message: 'Value must be unique' }] } }] }, 400)
  let resolveSave!: (value: Response) => void
  const secondSave = new Promise<Response>(resolve => { resolveSave = resolve })
  const fetch = vi.fn().mockResolvedValueOnce(duplicateResponse()).mockReturnValueOnce(secondSave)
  vi.stubGlobal('fetch', fetch)
  await newClick('Hero')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(duplicateSlug)).toBeTruthy()
  const details = document.querySelector('details')!
  expect(details.open).toBe(true)
  details.open = false
  fireEvent(details, new Event('toggle'))
  expect(details.open).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(fetch).toHaveBeenCalledTimes(2)
  await act(async () => { resolveSave(duplicateResponse()) })
  expect(details.open).toBe(true)
})
test('a saved click source selects the shared click option and list uses its kind badge', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/xp-experiments?') ? { docs: [] } : { ...goal, source: 'click:hero-cta' })))
  const view = render(<GoalForm surface={clickSurface} id="7" />)
  await screen.findByLabelText('Name')
  expect((screen.getByLabelText('Measured by') as HTMLSelectElement).value).toBe('click:')
  expect(screen.queryByRole('option', { name: 'click:hero-cta' })).toBeNull()
  view.unmount()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response({ docs: url.includes('/xp-experiments?') ? [] : [{ ...goal, source: 'click:hero-cta' }] })))
  render(<GoalsList surface={clickSurface} />)
  await screen.findByRole('link', { name: 'Register' })
  expect(screen.getByText('Yes/no')).toBeTruthy()
  expect(screen.queryByText('click:hero-cta')).toBeNull()
})

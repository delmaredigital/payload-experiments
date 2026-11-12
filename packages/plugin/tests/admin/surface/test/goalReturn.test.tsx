// @vitest-environment jsdom
import { StrictMode } from 'react'
import type { ComponentProps } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { XP_IF_UPDATED_AT_HEADER } from '../../../../src/constants.js'
import { GoalSection } from '../../../../src/testSurface/surface/test/GoalSection.js'
import { useTestDocument } from '../../../../src/testSurface/surface/useTestDocument.js'
import type { TestDocument } from '../../../../src/testSurface/surface/testDocument.model.js'
import { doc, preflight, props } from '../readiness/fixtures.js'

vi.mock('@payloadcms/ui', () => ({ Link: (props: ComponentProps<'a'>) => <a {...props} /> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
const surface = props().surface
function TestGoal() {
  const test = useTestDocument(doc.id, { apiRoute: surface.apiRoute })
  return test.doc ? <><GoalSection test={test} surface={surface} /><p data-testid="saving">{test.saving}</p></> : null
}
function setup(metrics: TestDocument['metrics'], options: { goalId?: string | number; status?: TestDocument['status']; refuse?: boolean } = {}) {
  const goalId = options.goalId ?? 7
  const loaded = { ...doc, metrics, status: options.status ?? 'draft', updatedAt: '2026-11-03T10:00:00.000Z' }
  window.history.replaceState(null, '', `/admin/experiments/${doc.id}?${new URLSearchParams({ goal: String(goalId), locale: 'en' })}#section-win`)
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/xp-metrics')) return response({ docs: [{ id: goalId, name: 'Chosen goal', source: 'signup' }] })
    if (url.endsWith('/preflight')) return response(preflight())
    if (init?.method === 'PATCH') return options.refuse ? response({ errors: [{ message: 'Save refused.' }] }, 400)
      : response({ doc: { ...loaded, ...JSON.parse(init.body as string), updatedAt: '2026-11-03T10:01:00.000Z' } })
    return response(loaded)
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(<StrictMode><TestGoal /></StrictMode>)
  const patches = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')
  return { view, patches, loaded }
}
function expectCleared() {
  expect(window.location.search).toBe('?locale=en')
  expect(window.location.hash).toBe('#section-win')
}

test.each(['draft', 'stopped'] as const)('an existing chosen goal replaces the %s main goal through the normal PATCH with its stale-edit header', async status => {
  const { view, patches, loaded } = setup({ primary: 1, guardrails: [2], secondary: [3] }, { status })
  await waitFor(() => expect(screen.getByTestId('saving').textContent).toBe('saved'))
  expect(patches()).toHaveLength(1)
  const [url, request] = patches()[0]!
  expect(url).toBe(`/custom-api/xp-experiments/${doc.id}?depth=0`)
  expect(request).toMatchObject({ credentials: 'include', headers: { [XP_IF_UPDATED_AT_HEADER]: loaded.updatedAt } })
  expect(JSON.parse(request!.body as string)).toEqual({ metrics: { primary: 7, guardrails: [2], secondary: [3] } })
  expectCleared()
  view.rerender(<StrictMode><TestGoal /></StrictMode>)
  await act(async () => {})
  expect(patches()).toHaveLength(1)
})

test.each([
  { role: 'guardrails', goalId: 7, savedId: 7 },
  { role: 'guardrails', goalId: 7, savedId: '7' },
  { role: 'secondary', goalId: 'goal-uuid', savedId: 'goal-uuid' },
] as const)('moves goal $goalId from $role to main in the same PATCH', async ({ role, goalId, savedId }) => {
  const { patches } = setup({ primary: 1, guardrails: [2], secondary: [3], [role]: [savedId, role === 'guardrails' ? 2 : 3] }, { goalId })
  await waitFor(() => expect(screen.getByTestId('saving').textContent).toBe('saved'))
  expect(patches()).toHaveLength(1)
  expect(JSON.parse(patches()[0]![1]!.body as string)).toEqual({ metrics: { primary: goalId, guardrails: [2], secondary: [3] } })
  expectCleared()
})

test('a running test clears the goal param without a PATCH', async () => {
  const { patches } = setup({ primary: 1, guardrails: [2], secondary: [3] }, { status: 'running' })
  await waitFor(() => expect(window.location.search).toBe('?locale=en'))
  await act(async () => {})
  expect(patches()).toHaveLength(0)
  expectCleared()
})

test('a failed save also clears the goal param and does not reapply it on remount', async () => {
  const { view, patches } = setup({ primary: 1, guardrails: [2], secondary: [3] }, { refuse: true })
  await waitFor(() => expect(screen.getByTestId('saving').textContent).toBe('error'))
  expect(patches()).toHaveLength(1)
  expectCleared()
  view.unmount()
  render(<StrictMode><TestGoal /></StrictMode>)
  await screen.findByRole('combobox', { name: 'Goal' })
  await act(async () => {})
  expect(patches()).toHaveLength(1)
})

test('only the main goal opens return mode; guardrail and supporting pickers never link with return', async () => {
  setup({ primary: 1, guardrails: [2], secondary: [3] })
  await waitFor(() => expect(screen.getByTestId('saving').textContent).toBe('saved'))
  const returnLinks = screen.getAllByRole('link').filter(link => link.getAttribute('href')?.includes('?return='))
  expect(returnLinks).toHaveLength(1)
  expect(returnLinks[0]!.textContent).toBe('Manage goals')
  expect(returnLinks[0]!.closest('.xp-ui-field-label')?.querySelector('label')?.textContent).toBe('Goal')
  for (const label of ['Must not get worse (optional)', 'Also keep an eye on (optional)']) {
    expect(within(screen.getByRole('group', { name: label })).queryAllByRole('link')
      .filter(link => link.getAttribute('href')?.includes('?return='))).toHaveLength(0)
  }
})

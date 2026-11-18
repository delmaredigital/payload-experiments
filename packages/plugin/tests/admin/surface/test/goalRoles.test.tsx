// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GoalSection } from '../../../../src/testSurface/surface/test/GoalSection.js'
import { props } from '../readiness/fixtures.js'
import { useTestDocument } from '../../../../src/testSurface/surface/useTestDocument.js'
const goals = [{ id: 1, name: 'Registration', source: 'signup' }, { id: 'two', name: 'Completion', source: 'signup' }, { id: 3, name: 'Donation', source: 'signup' }]
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ docs: goals })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test.each([false, true])('one collapsed optional list has one role per remaining goal (embedded: %s)', async embedded => {
  const p = props({ metrics: { primary: 1, guardrails: [], secondary: [] } })
  const view = render(<GoalSection {...p} embedded={embedded} />)
  await screen.findByRole('option', { name: 'Completion · signup' })
  const other = screen.getByText('Other goals (optional)').closest('details')!
  expect(other.open).toBe(false)
  fireEvent.click(within(other).getByText('Other goals (optional)'))
  expect(within(other).getAllByRole('combobox')).toHaveLength(2)
  expect(within(other).queryByLabelText('Registration · signup')).toBeNull()
  for (const name of ['Completion · signup', 'Donation · signup']) {
    expect(within(other).getAllByLabelText(name)).toHaveLength(1)
    expect(within(within(other).getByLabelText(name)).getAllByRole('option').map(node => node.textContent)).toEqual(["Don't track", 'Watch', 'Must not get worse'])
  }
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.getByText("Watch: shown in results. Must not get worse: you're warned if a version makes it worse.")).toBeTruthy()
  expect(screen.getByText('The one thing you want more of. It decides the winner.')).toBeTruthy()
  expect(screen.getByLabelText('Goal').closest('.xp-ui-select-wrap')).toBeTruthy()
  p.test.doc!.metrics = { primary: 1, guardrails: [3], secondary: ['two'] }
  view.rerender(<GoalSection {...p} embedded={embedded} />)
  expect(screen.getByText('Other goals · 2').closest('details')!.open).toBe(true)
  expect((screen.getByLabelText('Completion · signup') as HTMLSelectElement).value).toBe('secondary')
  expect((screen.getByLabelText('Donation · signup') as HTMLSelectElement).value).toBe('guardrails')
  expect(p.test.stage).not.toHaveBeenCalled()
  p.test.doc!.metrics = { primary: 1, guardrails: [], secondary: [] }
  view.rerender(<GoalSection {...p} embedded={embedded} />)
  expect(screen.getByText('Other goals (optional)').closest('details')!.open).toBe(false)
})

test('a role changes exclusively, and promoting a watched goal clears its other role in the same payload', async () => {
  const p = props({ metrics: { primary: 1, guardrails: [3], secondary: ['two'] } })
  const view = render(<GoalSection {...p} />)
  const role = await screen.findByLabelText('Completion · signup')
  fireEvent.change(role, { target: { value: 'guardrails' } })
  expect(p.test.stage).toHaveBeenLastCalledWith({ metrics: { primary: 1, guardrails: [3, 'two'], secondary: [] } })
  p.test.doc!.metrics = { primary: 1, guardrails: [3, 'two'], secondary: [] }
  view.rerender(<GoalSection {...p} />)
  fireEvent.change(screen.getByLabelText('Completion · signup'), { target: { value: '' } })
  expect(p.test.stage).toHaveBeenLastCalledWith({ metrics: { primary: 1, guardrails: [3], secondary: [] } })
  fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'two' } })
  expect(p.test.stage).toHaveBeenLastCalledWith({ metrics: { primary: 'two', guardrails: [3], secondary: [] } })
  p.test.doc!.metrics = { primary: 'two', guardrails: [3], secondary: [] }
  view.rerender(<GoalSection {...p} />)
  expect(screen.getByText('Other goals · 1').closest('details')?.querySelectorAll('label')).toHaveLength(2)
  expect(within(screen.getByText('Other goals · 1').closest('details')!).queryByLabelText('Completion · signup')).toBeNull()
})

test('no other goals means no optional section', async () => {
  vi.mocked(fetch).mockImplementation(async () => Response.json({ docs: goals.slice(0, 1) }))
  render(<GoalSection {...props({ metrics: { primary: 1 } })} />)
  await screen.findByRole('option', { name: 'Registration · signup' })
  expect(screen.queryByText(/Other goals/)).toBeNull()
})

test('existing primary, guardrail and secondary ids round-trip through the real document PATCH unchanged', async () => {
  const initial = { ...props().test.doc!, updatedAt: '2026-11-03T10:00:00.000Z', metrics: { primary: 1, guardrails: [3], secondary: ['two'] } }
  let saved = initial
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes('/xp-metrics?')) return Response.json({ docs: goals })
    if (String(input).endsWith('/click-keys')) return Response.json({ keys: [] })
    if (String(input).endsWith('/preflight')) return Response.json({ checks: [], placements: [] })
    if (init?.method === 'PATCH') { saved = { ...saved, ...JSON.parse(String(init.body)) }; return Response.json({ doc: saved }) }
    return Response.json(saved)
  })
  function Harness() {
    const test = useTestDocument(initial.id, { apiRoute: '/custom-api' })
    return test.doc ? <><GoalSection test={test} surface={props().surface} /><output>{test.saving}</output></> : null
  }
  render(<Harness />)
  const role = await screen.findByLabelText('Completion · signup')
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  fireEvent.change(role, { target: { value: 'guardrails' } })
  await waitFor(() => expect(screen.getByText('saved', { selector: 'output' })).toBeTruthy())
  const patches = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')
  expect(JSON.parse(String(patches()[0]![1]!.body))).toEqual({ metrics: { primary: 1, guardrails: [3, 'two'], secondary: [] } })
  fireEvent.change(screen.getByLabelText('Completion · signup'), { target: { value: 'secondary' } })
  await waitFor(() => expect(patches()).toHaveLength(2))
  const request = patches()[1]![1]!
  expect(JSON.parse(String(request.body))).toEqual({ metrics: initial.metrics })
  expect(request.headers).toMatchObject({ 'x-xp-if-updated-at': initial.updatedAt })
})

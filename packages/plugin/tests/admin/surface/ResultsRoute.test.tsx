// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ResultsRoute } from '../../../src/admin/surface/ResultsRoute.js'
import { TestHeader } from '../../../src/admin/surface/test/TestHeader.js'
import { props } from './readiness/fixtures.js'

const mocks = vi.hoisted(() => ({ hook: vi.fn(), body: vi.fn() }))
vi.mock('../../../src/admin/surface/useTestDocument.js', () => ({ useTestDocument: mocks.hook }))
vi.mock('../../../src/admin/surface/results/ResultsBody.js', () => ({ ResultsBody: (input: unknown) => { mocks.body(input); return <p>Results body</p> } }))
vi.mock('../../../src/admin/surface/readiness/parts.js', () => ({ readinessParts: {
  Banner: () => <p>Readiness banner</p>, SaveStatus: () => <span>Save status</span>,
} }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
test('managers see the shared header, readiness, saving state, setup link, and results body', () => {
  const p = props({ id: 12, status: 'running' })
  mocks.hook.mockReturnValue(p.test)
  render(<ResultsRoute id="12" surface={{ ...p.surface, canReadResults: true }} />)
  expect(mocks.hook).toHaveBeenCalledWith('12', { apiRoute: '/custom-api' })
  expect(screen.getByLabelText('Test name')).toBeTruthy()
  expect(screen.getByText('Readiness banner')).toBeTruthy()
  expect(screen.getByText('Save status')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to setup' }).getAttribute('href')).toBe('/admin/experiments/12')
  expect(screen.queryByRole('link', { name: 'Results' })).toBeNull()
  expect(screen.getByText('Results body')).toBeTruthy()
})
test('results-only readers render the body without requesting the manager document or showing forbidden copy', () => {
  const { surface } = props()
  render(<ResultsRoute id="12" surface={{ ...surface, canManage: false, canReadResults: true }} />)
  expect(mocks.hook).not.toHaveBeenCalled()
  expect(mocks.body).toHaveBeenCalledWith({ id: '12', surface: { ...surface, canManage: false, canReadResults: true } })
  expect(screen.getByText('Results body')).toBeTruthy()
  expect(screen.queryByLabelText('Test name')).toBeNull()
  expect(screen.queryByText(/access/)).toBeNull()
})
test('a manager can retry a failed document read while results remain available', () => {
  const p = props({}, { loadState: 'error', doc: null })
  mocks.hook.mockReturnValue(p.test)
  render(<ResultsRoute id="12" surface={p.surface} />)
  expect(screen.getByText("Couldn't load this test.")).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(screen.getByText('Results body')).toBeTruthy()
})

test('the results header setup link supports the root admin route', () => {
  const p = props({ id: 12, status: 'running' })
  render(<TestHeader {...p} surface={{ ...p.surface, adminRoute: '/' }} />)
  expect(screen.getByRole('link', { name: 'Back to setup' }).getAttribute('href')).toBe('/experiments/12')
})


test.each([
  ['missing', 'This test no longer exists.'],
  ['forbidden', "You don't have access to this test."],
] as const)('a manager sees only the header message for %s', (loadState, message) => {
  const p = props({}, { loadState, doc: null })
  mocks.hook.mockReturnValue(p.test)
  render(<ResultsRoute id="12" surface={p.surface} />)
  expect(screen.getAllByText(message)).toHaveLength(1)
  expect(mocks.body).not.toHaveBeenCalled()
  expect(screen.queryByText('Results body')).toBeNull()
})

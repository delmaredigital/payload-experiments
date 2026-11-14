// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { classifyReadinessRead } from '../../../src/testSurface/readinessRead.js'
import { ResultsRoute } from '../../../src/admin/surface/ResultsRoute.js'
import type { ResultsResponse } from '../../../src/types/endpoints.js'
import { preflight, props } from './readiness/fixtures.js'

const mocks = vi.hoisted(() => ({ hook: vi.fn(), body: vi.fn(), data: undefined as ResultsResponse | undefined }))
vi.mock('../../../src/testSurface/surface/useTestDocument.js', () => ({ useTestDocument: mocks.hook }))
vi.mock('../../../src/testSurface/surface/results/ResultsBody.js', () => ({ ResultsBody: (input: { renderPage?: (parts: import('../../../src/testSurface/surface/results/ResultsBody.js').ResultsPageParts) => import('react').ReactNode }) => { mocks.body(input); return input.renderPage ? input.renderPage({ children: <p>Results body</p>, actions: null, released: null, data: mocks.data }) : <p>Results body</p> } }))
vi.mock('../../../src/testSurface/surface/readiness/parts.js', () => ({ readinessParts: {
  Banner: () => <p>Readiness banner</p>, SaveStatus: () => <span>Save status</span>,
} }))
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.data = undefined })
test('managers see Shell title, kind, status, subtitle, header actions and results body', () => {
  const p = props({ id: 12, status: 'running' })
  mocks.hook.mockReturnValue(p.test)
  render(<ResultsRoute id="12" surface={{ ...p.surface, canReadResults: true }} />)
  expect(mocks.hook).toHaveBeenCalledWith('12', { apiRoute: '/custom-api' })
  expect(screen.getByRole('heading', { name: 'Headline', level: 1 })).toBeTruthy()
  expect(screen.getAllByText('Running')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Stop' }).closest('header')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to setup' }).getAttribute('href')).toBe('/admin/experiments/12')
  expect(screen.queryByRole('link', { name: 'Results' })).toBeNull()
  expect(screen.getByText('Results body')).toBeTruthy()
})
test('results-only readers render the body without requesting the manager document or showing forbidden copy', () => {
  const { surface } = props()
  render(<ResultsRoute id="12" surface={{ ...surface, canManage: false, canReadResults: true }} />)
  expect(mocks.hook).not.toHaveBeenCalled()
  expect(mocks.body).toHaveBeenCalledWith(expect.objectContaining({ id: '12', surface: { ...surface, canManage: false, canReadResults: true } }))
  expect(screen.getByText('Results body')).toBeTruthy()
  expect(screen.queryByLabelText('Test name')).toBeNull()
  expect(screen.queryByText(/access/)).toBeNull()
})
test('a manager can retry a failed document read while results remain available', () => {
  const p = props({}, { loadState: 'error', doc: null, preflightRead: classifyReadinessRead(503) })
  mocks.hook.mockReturnValue(p.test)
  render(<ResultsRoute id="12" surface={p.surface} />)
  expect(screen.getByText("Couldn't check readiness. Try again.")).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(screen.getByText('Results body')).toBeTruthy()
})

test('the results header setup link supports the root admin route', () => {
  const p = props({ id: 12, status: 'running' })
  mocks.hook.mockReturnValue(p.test)
  render(<ResultsRoute id={12} surface={{ ...p.surface, adminRoute: '/' }} />)
  expect(screen.getByRole('link', { name: 'Back to setup' }).getAttribute('href')).toBe('/experiments/12')
})


test.each([
  ['missing', 404, 'This test no longer exists.'],
  ['forbidden', 403, "You don't have permission to check where this test is used."],
] as const)('a manager sees only the header message for %s', (loadState, status, message) => {
  const p = props({}, { loadState, doc: null, preflightRead: classifyReadinessRead(status) })
  mocks.hook.mockReturnValue(p.test)
  render(<ResultsRoute id="12" surface={p.surface} />)
  expect(screen.getAllByText(message)).toHaveLength(1)
  expect(mocks.body).not.toHaveBeenCalled()
  expect(screen.queryByText('Results body')).toBeNull()
})

test.each([
  ['running', 'block', ['Let more people in', 'Stop']],
  ['decided', 'block', ['Make it the content', 'Discard winner']],
  ['archived', 'page', []],
] as const)('%s %s has the existing actions in the Shell header', (status, kind, labels) => {
  const p = props({ id: 12, status, kind, decision: { phase: 1, winnerArm: 'variantA' } })
  mocks.hook.mockReturnValue(p.test)
  const { container } = render(<ResultsRoute id={12} surface={{ ...p.surface, canReadResults: true }} />)
  const header = container.querySelector('.xp-tests-shell-header')!
  expect(Array.from(header.querySelectorAll('.xp-tests-shell-actions button')).map(el => el.textContent)).toEqual(labels)
  expect(header.querySelector('.xp-ui-button-group a')?.textContent).toBe('Back to setup')
  expect(screen.getByRole('link', { name: 'Headline' }).getAttribute('href')).toBe('/admin/experiments/12')
  expect(header.querySelector('.xp-tests-shell-subtitle')).toBeTruthy()
  if (status === 'running') expect(screen.getByRole('button', { name: 'Stop' }).classList.contains('xp-ui-button--danger')).toBe(true)
})


test('stopped restart retains its settled label while pending disables the action', () => {
  const p = props({ id: 12, status: 'stopped' }, { preflightPending: true })
  mocks.hook.mockReturnValue(p.test)
  render(<ResultsRoute id={12} surface={p.surface} />)
  const restart = screen.getByRole('button', { name: 'Start a new round' }) as HTMLButtonElement
  expect(restart.disabled).toBe(true)
  expect(restart.title).toBe('')
  expect(restart.textContent).toBe('Start a new round')
})

test.each([true, false])('localized make-content warning appears in the decided header only for managers (%s)', canManage => {
  const p = props({ status: 'decided', decision: { phase: 1, winnerArm: 'variantA' } }, {
    preflight: preflight([{ code: 'make-content-unsupported', ok: true, warning: true, detail: 'Landing page' }]),
  })
  mocks.hook.mockReturnValue(p.test)
  const { container } = render(<ResultsRoute id={12} surface={{ ...p.surface, canManage, canReadResults: true }} />)
  const warning = within(container.querySelector('header')!).queryByText("Landing page has more than one language, so Make it the content isn't available for it; you'll copy the winning version by hand.")
  expect(Boolean(warning)).toBe(canManage)
  if (canManage) expect(warning?.closest('.xp-ui-banner--warning')).toBeTruthy()
})
test.each(['Donation form', undefined, '', '   '])('reader title and crumb use response name %j with Test as fallback', name => {
  mocks.data = { ...(name !== undefined ? { experiment: { name, kind: 'block' as const, status: 'running' as const } } : {}), phases: [], snapshot: null }
  const p = props()
  render(<ResultsRoute id={12} surface={{ ...p.surface, canManage: false, canReadResults: true }} />)
  const title = name?.trim() || 'Test'
  expect(screen.getByRole('heading', { name: title, level: 1 })).toBeTruthy()
  expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText(title)).toBeTruthy()
  expect(mocks.hook).not.toHaveBeenCalled()
})
test('manager title and crumb keep the document name when the response has a name', () => {
  mocks.data = { experiment: { name: 'Response name', kind: 'block', status: 'running' }, phases: [], snapshot: null }
  const p = props({ status: 'decided' })
  mocks.hook.mockReturnValue(p.test)
  render(<ResultsRoute id={12} surface={p.surface} />)
  expect(screen.getByRole('heading', { name: 'Headline', level: 1 })).toBeTruthy()
  expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Headline')).toBeTruthy()
  expect(screen.queryByText('Response name')).toBeNull()
})

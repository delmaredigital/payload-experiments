// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ResultsRoute } from '../../../src/admin/surface/ResultsRoute.js'
import type { TestDocument } from '../../../src/admin/surface/testDocument.model.js'
import { API_MESSAGES } from '../../../src/admin/copy/common.js'
import { props } from './readiness/fixtures.js'
import { resetPayloadUiMock, setAuth, setConfig } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
vi.mock('../../../src/admin/surface/readiness/parts.js', () => ({ readinessParts: {
  Banner: () => null, SaveStatus: () => null,
} }))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const at = '2026-11-03T12:00:00Z'
const eligible = props({ id: 'page/test', kind: 'page', status: 'archived', decision: { phase: 1, winnerArm: 'variantA' } }).test.doc!
const surface = { ...props().surface, canReadResults: true }
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  setAuth({ user: { id: 7 } })
  const config = { config: { routes: { api: '/custom-api', admin: '/admin' }, admin: { user: 'editors' } } }
  setConfig(config)
})
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.clearAllMocks() })

function setup(doc: TestDocument = eligible, options: { refusal?: Response; author?: Response | Error } = {}) {
  let saved = structuredClone(doc)
  const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/release-pages')) {
      if (options.refusal) return options.refusal
      saved = { ...saved, decision: { ...(saved.decision as object), pagesReleasedAt: at, pagesReleasedBy: '7' } }
      return json({ doc: saved, revision: 2 })
    }
    if (url.includes('/editors/')) {
      if (options.author instanceof Error) throw options.author
      return options.author ?? json({ name: 'Alex Editor', email: 'alex@example.test' })
    }
    if (url.includes('/xp-experiments/')) return json(saved)
    if (url.endsWith('/preflight')) return json({ checks: [], placements: [] })
    return json({ phases: [], snapshot: null, decision: saved.decision })
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

test('eligible manager action is secondary and grouped above the results body; Cancel is focused', async () => {
  setup()
  render(<ResultsRoute id={eligible.id} surface={surface} />)
  const action = await screen.findByRole('button', { name: 'Release pages' })
  expect(action.classList.contains('xp-ui-button--secondary')).toBe(true)
  expect(action.closest('.xp-ui-button-group')?.textContent).toContain('Recompute')
  fireEvent.click(action)
  expect(screen.getByRole('dialog', { name: 'Release pages' })).toBeTruthy()
  expect(screen.getByText('Every address shows its own page again. The result stays recorded.')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test.each([
  { kind: 'block' }, { kind: 'flag' }, { kind: 'code' }, { status: 'draft' }, { status: 'running' }, { status: 'stopped' }, { status: 'decided' },
  { decision: { phase: 1, winnerArm: 'variantA', discardedAt: at } },
  { decision: { phase: 1, winnerArm: 'variantA', pagesReleasedAt: at } },
  { decision: { phase: 1 } },
] as Partial<TestDocument>[])('action is hidden for %j', async patch => {
  setup({ ...eligible, ...patch })
  render(<ResultsRoute id={eligible.id} surface={surface} />)
  await screen.findByText(/No results yet/)
  expect(screen.queryByRole('button', { name: 'Release pages' })).toBeNull()
})
test('non-managers have no release action or manager document read', async () => {
  const fetcher = setup()
  render(<ResultsRoute id={eligible.id} surface={{ ...surface, canManage: false }} />)
  await screen.findByText(/No results yet/)
  expect(screen.queryByRole('button', { name: 'Release pages' })).toBeNull()
  expect(fetcher.mock.calls.some(([url]) => url.includes('/xp-experiments/'))).toBe(false)
})

test('results-only readers never see a release line or who released, even if a release is recorded', async () => {
  const fetcher = setup({ ...eligible, decision: { phase: 1, winnerArm: 'variantA', pagesReleasedAt: at, pagesReleasedBy: '7' } })
  render(<ResultsRoute id={eligible.id} surface={{ ...surface, canManage: false }} />)
  await screen.findByText(/No results yet/)
  expect(screen.queryByText(/Pages released/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Release pages' })).toBeNull()
  expect(fetcher.mock.calls.some(([url]) => url.includes('/xp-experiments/'))).toBe(false)
})

test('success posts once, latches Escape while busy, refetches the document and shows the audit line', async () => {
  const fetcher = setup()
  const original = fetcher.getMockImplementation()!
  let finish!: () => void
  fetcher.mockImplementation((url, init) => url.endsWith('/release-pages') ? new Promise(resolve => {
    finish = () => { void original(url, init).then(resolve) }
  }) : original(url, init))
  const view = render(<ResultsRoute id={eligible.id} surface={surface} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Release pages' }))
  const dialog = screen.getByRole('dialog')
  const submit = within(dialog).getByRole('button', { name: 'Release pages' }) as HTMLButtonElement
  const reads = () => fetcher.mock.calls.filter(([url]) => url.includes('/xp-experiments/')).length
  const before = reads()
  act(() => { submit.click(); submit.click() })
  expect(submit.disabled).toBe(true)
  expect(submit.getAttribute('aria-busy')).toBe('true')
  fireEvent.keyDown(dialog, { key: 'Escape' })
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  expect(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')).toEqual([
    '/custom-api/xp/experiments/page%2Ftest/release-pages', { method: 'POST', credentials: 'include' },
  ])
  await act(async () => finish())
  await screen.findByText('Pages released 3 Nov 2026 by you')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Release pages' })).toBeNull())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(reads()).toBeGreaterThan(before)
  expect(fetcher.mock.calls.some(([url]) => url.includes('/editors/'))).toBe(false)
  view.unmount()
  render(<ResultsRoute id={eligible.id} surface={surface} />)
  expect(await screen.findByText('Pages released 3 Nov 2026 by you')).toBeTruthy()
})

test('refusal closes the dialog and renders only the mapped error Banner above the body; retry remains available', async () => {
  setup(eligible, { refusal: json({ errors: [{ code: 'forbidden', message: 'Private server detail' }] }, 403) })
  render(<ResultsRoute id={eligible.id} surface={surface} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Release pages' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Release pages' }))
  const banner = await screen.findByRole('alert')
  expect(banner.textContent).toBe(API_MESSAGES.forbidden)
  expect(banner.classList.contains('xp-ui-banner--error')).toBe(true)
  expect(banner.compareDocumentPosition(screen.getByText(/No results yet/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByText('Private server detail')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('button', { name: 'Release pages' })).toBeTruthy()
})

test.each([
  [json({ name: 'Alex Editor', email: 'alex@example.test' }), 'Pages released 3 Nov 2026 by Alex Editor'],
  [json({ email: 'alex@example.test' }), 'Pages released 3 Nov 2026 by alex@example.test'],
  [json({}, 403), 'Pages released 3 Nov 2026'],
  [new Error('offline'), 'Pages released 3 Nov 2026'],
] as const)('later visits resolve the author once or retain the date (%s)', async (author, line) => {
  const fetcher = setup({ ...eligible, decision: { winnerArm: 'variantA', pagesReleasedAt: at, pagesReleasedBy: 'other/editor' } }, { author })
  render(<ResultsRoute id={eligible.id} surface={surface} />)
  await screen.findByText(line)
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.includes('/editors/'))).toHaveLength(1))
  const url = new URL(fetcher.mock.calls.find(([url]) => url.includes('/editors/'))![0], 'https://example.test')
  expect(url.pathname).toBe('/custom-api/editors/other%2Feditor')
  expect(Object.fromEntries(url.searchParams)).toEqual({ depth: '0', 'select[name]': 'true', 'select[email]': 'true' })
})

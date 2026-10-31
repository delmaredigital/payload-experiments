// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PhaseHistory } from '../../../src/admin/PhaseHistory.js'
import { resetPayloadUiMock, setConfig, setDocumentInfo, setFormFields } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
test('fetches rounds for the current experiment and shows the editor decision without the id', async () => {
  setDocumentInfo({ id: 7, data: {} })
  setFormFields({ 'decision.decidedBy': { value: 'opaque-user' } })
  setConfig({ config: { routes: { api: '/cms-api', admin: '/admin' } } })
  const fetcher = vi.fn(async (_input: string) => ({ ok: true, json: async () => ({ docs: [{
    phase: 2, phaseKind: 'test', startedAt: '2026-10-03', endedAt: '2026-10-17', arms: [{ weight: 45 }, { weight: 45 }, { weight: 10 }],
  }] }) }))
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<PhaseHistory path="history" field={{ name: 'history', type: 'ui', admin: {} }} />)
  expect(await screen.findByText('Round 2 · during the test · Oct 3 – Oct 17 · 45/45/10')).toBeTruthy()
  expect(screen.getByText('Decided by an editor')).toBeTruthy()
  expect(container.textContent).not.toContain('opaque-user')
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/cms-api/xp-phases?'), expect.objectContaining({ credentials: 'include' }))
  const query = new URL(fetcher.mock.calls[0]![0]!, 'https://example.com').searchParams
  expect(query.get('where[experiment][equals]')).toBe('7')
  expect(query.get('sort')).toBe('phase,startedAt')
  expect(query.get('depth')).toBe('0')
})
test('403 is hidden', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })))
  const { container } = render(<PhaseHistory path="history" field={{ name: 'history', type: 'ui', admin: {} }} />)
  await act(async () => {})
  expect(container.textContent).toBe('')
})
test.each([undefined, null])('create is hidden and sends no requests (%s)', id => {
  setDocumentInfo({ id })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<PhaseHistory path="history" field={{ name: 'history', type: 'ui', admin: {} }} />)
  expect(container.textContent).toBe('')
  expect(fetcher).not.toHaveBeenCalled()
})
test('test and rollout rows sharing a number have distinct keys and chronological order', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ docs: [
    { phase: 2, phaseKind: 'rollout', startedAt: '2026-10-17', arms: [{ weight: 90 }, { weight: 10 }] },
    { phase: 2, phaseKind: 'test', startedAt: '2026-10-03', endedAt: '2026-10-17', arms: [{ weight: 45 }, { weight: 45 }, { weight: 10 }] },
  ] }) })))
  render(<PhaseHistory path="history" field={{ name: 'history', type: 'ui', admin: {} }} />)
  await screen.findByText('Round 2 · after shipping · Oct 17 – now · 90/10')
  expect(screen.getAllByRole('listitem').map(row => row.textContent)).toEqual([
    'Round 2 · during the test · Oct 3 – Oct 17 · 45/45/10',
    'Round 2 · after shipping · Oct 17 – now · 90/10',
  ])
  expect(errors).not.toHaveBeenCalled()
})
test('a late phase-history response cannot overwrite the newer experiment history', async () => {
  setDocumentInfo({ id: 1 })
  let resolveOld!: (value: unknown) => void
  const fetcher = vi.fn((input: string) => new URL(input, 'https://example.com').searchParams.get('where[experiment][equals]') === '1'
    ? new Promise(resolve => { resolveOld = resolve })
    : Promise.resolve({ ok: true, json: async () => ({ docs: [{ phase: 3, phaseKind: 'test', startedAt: '2026-10-17', arms: [{ weight: 100 }] }] }) }))
  vi.stubGlobal('fetch', fetcher)
  render(<PhaseHistory path="history" field={{ name: 'history', type: 'ui', admin: {} }} />)
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
  act(() => setDocumentInfo({ id: 2 }))
  const message = 'Round 3 · during the test · Oct 17 – now · 100'
  expect(await screen.findByText(message)).toBeTruthy()
  await act(async () => resolveOld({ ok: true, json: async () => ({ docs: [{ phase: 1, phaseKind: 'test', startedAt: '2026-10-03', arms: [{ weight: 100 }] }] }) }))
  expect(screen.getByText(message)).toBeTruthy()
  expect(screen.queryByText(/Round 1/)).toBeNull()
})

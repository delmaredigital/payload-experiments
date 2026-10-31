// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PhaseHistory } from '../../../src/admin/PhaseHistory.js'
import { resetPayloadUiMock, setConfig, setDocumentInfo, setFormFields } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals() })
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
  expect(query.get('sort')).toBe('phase')
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

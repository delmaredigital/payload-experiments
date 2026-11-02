// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useLayerExperiments } from '../../../src/admin/useLayerUsage.js'
import { resetPayloadUiMock, setConfig } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals() })
test('loads every page of usage claims with editor credentials', async () => {
  setConfig({ config: { routes: { api: '/cms-api', admin: '/admin' } } })
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input, 'https://example.com')
    const first = url.searchParams.get('page') === '1'
    return { ok: true, json: async () => ({ docs: [{ name: 'Test', status: 'running', layerSlices: first ? [1, 2] : [2, 3] }], hasNextPage: first }) }
  })
  vi.stubGlobal('fetch', fetcher)
  const { result } = renderHook(() => useLayerExperiments('layer/one'))
  expect(result.current).toBeNull()
  await waitFor(() => expect(result.current).toMatchObject({ used: 3, free: 97 }))
  expect(fetcher.mock.calls).toHaveLength(2)
  const query = new URL(fetcher.mock.calls[0]![0], 'https://example.com').searchParams
  expect(query.get('where[layer][equals]')).toBe('layer/one')
  expect(query.get('where[status][in]')).toBe('running,decided')
  expect(query.get('depth')).toBe('0')
})
test('403 from experiments returns null', async () => {
  const fetcher = vi.fn(async () => ({ ok: false, status: 403 }))
  vi.stubGlobal('fetch', fetcher)
  const { result } = renderHook(() => useLayerExperiments(1))
  await act(async () => {})
  expect(result.current).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
test('no layer sends no request; changing layers clears old usage and ignores late responses', async () => {
  let resolveOld!: (value: unknown) => void
  const fetcher = vi.fn((input: string) => new URL(input, 'https://example.com').searchParams.get('where[layer][equals]') === '1'
    ? new Promise(resolve => { resolveOld = resolve })
    : Promise.resolve({ ok: true, json: async () => ({ docs: [] }) }))
  vi.stubGlobal('fetch', fetcher)
  const initialProps: { id: number | null } = { id: null }
  const { result, rerender } = renderHook(({ id }: { id: number | null }) => useLayerExperiments(id), { initialProps })
  expect(result.current).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
  rerender({ id: 1 })
  rerender({ id: 2 })
  expect(result.current).toBeNull()
  await waitFor(() => expect(result.current).toMatchObject({ used: 0, free: 100 }))
  await act(async () => resolveOld({ ok: true, json: async () => ({ docs: [{ name: 'Old test', status: 'running', layerSlices: [0] }] }) }))
  expect(result.current).toMatchObject({ used: 0, free: 100 })
  rerender({ id: null })
  expect(result.current).toBeNull()
})

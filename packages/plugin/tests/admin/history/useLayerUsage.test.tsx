// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useLayerUsage } from '../../../src/admin/useLayerUsage.js'
import { resetPayloadUiMock, setConfig } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals() })
test('loads the layer name and every page of slice claims with editor credentials', async () => {
  setConfig({ config: { routes: { api: '/cms-api', admin: '/admin' } } })
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input, 'https://example.com')
    if (url.pathname.includes('/xp-layers/')) return { ok: true, json: async () => ({ name: 'Homepage' }) }
    const first = url.searchParams.get('page') === '1'
    return { ok: true, json: async () => ({ docs: [{ name: 'Test', status: 'running', layerSlices: first ? [1, 2] : [2, 3] }], hasNextPage: first }) }
  })
  vi.stubGlobal('fetch', fetcher)
  const { result } = renderHook(() => useLayerUsage('layer/one'))
  expect(result.current).toBeNull()
  await waitFor(() => expect(result.current).toEqual({ name: 'Homepage', used: 3, free: 97 }))
  expect(fetcher).toHaveBeenCalledWith('/cms-api/xp-layers/layer%2Fone?depth=0', expect.objectContaining({ credentials: 'include' }))
  const query = new URL(fetcher.mock.calls[0]![0], 'https://example.com').searchParams
  expect(query.get('where[layer][equals]')).toBe('layer/one')
  expect(query.get('where[status][in]')).toBe('running,decided')
  expect(query.get('depth')).toBe('0')
})
test.each(['layer', 'experiments'])('403 from %s returns null', async denied => {
  const fetcher = vi.fn(async (input: string) => {
    if (input.includes(denied === 'layer' ? '/xp-layers/' : '/xp-experiments?')) return { ok: false, status: 403 }
    return { ok: true, json: async () => input.includes('/xp-layers/') ? { name: 'Home' } : { docs: [] } }
  })
  vi.stubGlobal('fetch', fetcher)
  const { result } = renderHook(() => useLayerUsage(1))
  await act(async () => {})
  expect(result.current).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(2)
})
test('no layer sends no request; changing layers clears old usage and ignores late responses', async () => {
  let resolveOld!: (value: unknown) => void
  const fetcher = vi.fn((input: string) => input.includes('/xp-layers/1')
    ? new Promise(resolve => { resolveOld = resolve })
    : Promise.resolve({ ok: true, json: async () => input.includes('/xp-layers/') ? { name: 'New layer' } : { docs: [] } }))
  vi.stubGlobal('fetch', fetcher)
  const initialProps: { id: number | null } = { id: null }
  const { result, rerender } = renderHook(({ id }: { id: number | null }) => useLayerUsage(id), { initialProps })
  expect(result.current).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
  rerender({ id: 1 })
  rerender({ id: 2 })
  expect(result.current).toBeNull()
  await waitFor(() => expect(result.current?.name).toBe('New layer'))
  await act(async () => resolveOld({ ok: true, json: async () => ({ name: 'Old layer' }) }))
  expect(result.current?.name).toBe('New layer')
  rerender({ id: null })
  expect(result.current).toBeNull()
})

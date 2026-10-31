import { afterEach, expect, test, vi } from 'vitest'
import { createApi } from '../../../src/admin/api.js'
import { requestSummary } from '../../../src/admin/summaryBatcher.js'

afterEach(() => vi.unstubAllGlobals())
const entry = { exposures: 1200, days: 4, verdict: { code: 'winner' as const, headline: 'Winner finding' } }

test('N cells with distinct useApi instances in one tick make one deduplicated request', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ one: entry, two: entry })))
  vi.stubGlobal('fetch', fetcher)
  const requests = ['one', 'two', 'one', 'missing'].map(id => requestSummary(createApi('/api'), id))
  expect(fetcher).not.toHaveBeenCalled()
  expect(await Promise.all(requests)).toEqual([entry, entry, entry, null])
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]![0]).toBe('/api/xp/experiments/summary?ids=one,two,missing')
})
test('150 ids split into concurrent 100 + 50 requests and each resolves its own entry', async () => {
  const fetcher = vi.fn(async (url: string) => {
    const ids = url.split('ids=')[1]!.split(',')
    return new Response(JSON.stringify(Object.fromEntries(ids.map(id => [id, { ...entry, exposures: Number(id) }]))))
  })
  vi.stubGlobal('fetch', fetcher)
  const api = createApi('/api')
  const result = await Promise.all(Array.from({ length: 150 }, (_, id) => requestSummary(api, id)))
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls.map(([url]) => url.split('ids=')[1]!.split(',').length)).toEqual([100, 50])
  expect(result.map(value => value?.exposures)).toEqual(Array.from({ length: 150 }, (_, id) => id))
})
test.each([501, 500])('%s resolves null for every caller', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })))
  const api = createApi('/api')
  expect(await Promise.all(['a', 'b', 'c'].map(id => requestSummary(api, id)))).toEqual([null, null, null])
})
test('each id is encoded individually while the separator remains a comma', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetcher)
  const api = createApi('/custom/api')
  await Promise.all(['a,b', 'slash/id', 'x & y'].map(id => requestSummary(api, id)))
  expect(fetcher.mock.calls[0]![0]).toBe('/custom/api/xp/experiments/summary?ids=a%2Cb,slash%2Fid,x%20%26%20y')
})
test('a thrown request resolves null; the next tick starts a fresh batch', async () => {
  const summary = vi.fn().mockRejectedValue(new Error('offline'))
  expect(await requestSummary({ summary }, 'a')).toBeNull()
  expect(await requestSummary({ summary }, 'b')).toBeNull()
  expect(summary).toHaveBeenCalledTimes(2)
})

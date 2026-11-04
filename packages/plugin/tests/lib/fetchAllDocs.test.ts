import { afterEach, expect, test, vi } from 'vitest'
import { fetchAllDocs } from '../../src/lib/fetchAllDocs.js'

afterEach(() => vi.unstubAllGlobals())
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

test('follows three pages, preserves query/credentials/signal and stops on hasNextPage false', async () => {
  const signal = new AbortController().signal
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [1], hasNextPage: true }))
    .mockResolvedValueOnce(response({ docs: [2], hasNextPage: true }))
    .mockResolvedValueOnce(response({ docs: [3], hasNextPage: false, totalPages: 99 }))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchAllDocs('/api/items?depth=0&limit=900&page=9&where[kind][equals]=block', { credentials: 'include', signal })).toEqual({ ok: true, docs: [1, 2, 3] })
  expect(fetch).toHaveBeenCalledTimes(3)
  fetch.mock.calls.forEach(([url, init], index) => {
    const params = new URL(url, 'https://example.test').searchParams
    expect(params.get('limit')).toBe('100')
    expect(params.getAll('limit')).toHaveLength(1)
    expect(params.get('page')).toBe(String(index + 1))
    expect(params.get('depth')).toBe('0')
    expect(params.get('where[kind][equals]')).toBe('block')
    expect(init).toEqual({ credentials: 'include', signal })
  })
})
test('uses totalPages when hasNextPage is absent', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [1], totalPages: 2 }))
    .mockResolvedValueOnce(response({ docs: [2], totalPages: 2 }))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchAllDocs('/items')).toEqual({ ok: true, docs: [1, 2] })
  expect(fetch).toHaveBeenCalledTimes(2)
})
test('returns page two refusal with status and body, never a partial success', async () => {
  const body = { errors: [{ message: 'Refused' }] }
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [1], hasNextPage: true })).mockResolvedValueOnce(response(body, 403))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchAllDocs('/items')).toEqual({ ok: false, status: 403, body })
  expect(fetch).toHaveBeenCalledTimes(2)
})
test('abort during a page stops the loop even if fetch ignores the signal', async () => {
  const controller = new AbortController()
  const fetch = vi.fn(async () => { controller.abort(); return response({ docs: [1], hasNextPage: true }) })
  vi.stubGlobal('fetch', fetch)
  await expect(fetchAllDocs('/items', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetch).toHaveBeenCalledOnce()
  await expect(fetchAllDocs('/items', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetch).toHaveBeenCalledOnce()
})
test('non-JSON HTTP errors still retain their status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))
  expect(await fetchAllDocs('/items')).toEqual({ ok: false, status: 403, body: undefined })
})

test('an endless server with empty docs stops immediately (bounded fake)', async () => {
  const fetch = vi.fn(async () => {
    if (fetch.mock.calls.length > 3) throw new Error('empty-page guard missing')
    return response({ docs: [], hasNextPage: true })
  })
  vi.stubGlobal('fetch', fetch)
  expect(await fetchAllDocs('/items')).toEqual({ ok: true, docs: [] })
  expect(fetch).toHaveBeenCalledOnce()
})
test('a server ignoring page stops at totalPages even with hasNextPage true', async () => {
  const fetch = vi.fn(async () => response({ docs: [{ id: 'one' }], totalPages: 2, hasNextPage: true }))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchAllDocs('/items')).toEqual({ ok: true, docs: [{ id: 'one' }] })
  expect(fetch).toHaveBeenCalledTimes(2)
})
test('deduplicates ids across pages, keeping the first document and its id type', async () => {
  const first = [{ id: 1, name: 'First' }, { id: 'uuid', name: 'UUID' }]
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: first, hasNextPage: true }))
    .mockResolvedValueOnce(response({ docs: [{ id: 1, name: 'Edited' }, { id: 'uuid', name: 'Edited UUID' }, { id: 2 }], hasNextPage: false }))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchAllDocs('/items')).toEqual({ ok: true, docs: [...first, { id: 2 }] })
})
test('a nonempty endless server fails distinctly at the 1000-page ceiling', async () => {
  const fetch = vi.fn(async () => response({ docs: [{ id: 1 }], hasNextPage: true }))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchAllDocs('/items')).toEqual({ ok: false, status: 0, body: undefined, reason: 'page-limit-exceeded' })
  expect(fetch).toHaveBeenCalledTimes(1000)
})

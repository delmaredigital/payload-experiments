// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { usePlacementLabels, placementDetailKey } from '../../../src/admin/placements/usePlacementLabels.js'
import { preflightPlacementLabel } from '../../../src/admin/placements/placementLabels.js'
import type { PreflightResult } from '../../../src/types/endpoints.js'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const page = { collection: 'pages', path: '/landing' }
const block = { collection: 'posts', id: 123, path: '/post' }
const noPath = { collection: 'posts', id: 456 }
const options = { details: [page, block, noPath, {}], apiRoute: '/api', adminRoute: '/cms', canManage: true, collectionTitles: { posts: 'headline' } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
test('preflight resolves page by raw path and block by id with no extra request', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const preflight = { placements: [{ collection: 'posts', id: 123, title: 'Post title', editorUrl: '/editor/post' }], pagePlacements: [{ collection: 'pages', path: '/landing', id: 7, title: 'Landing title', editorUrl: '/editor/home' }] } as PreflightResult
  const { result } = renderHook(() => usePlacementLabels({ ...options, preflight }))
  expect(result.current.get(placementDetailKey(page))).toEqual({ title: 'Landing title', href: '/editor/home' })
  expect(result.current.get(placementDetailKey(block))).toEqual({ title: 'Post title', href: '/editor/post' })
  expect(result.current.get(placementDetailKey(noPath))).toEqual({ title: 'This page', href: '/cms/collections/posts/456' })
  expect(fetcher).not.toHaveBeenCalled()
})
test('results resolves distinct page targets once and block ids in one collection read, using useAsTitle', async () => {
  const fetcher = vi.fn(async (url: string) => url.includes('/xp/pages?') ? json({ docs: [{ id: 7, title: 'Landing title' }] }) : json({ docs: [{ id: 123, headline: 'Article' }, { id: 456, headline: 'Another article' }] }))
  vi.stubGlobal('fetch', fetcher)
  const { result, rerender } = renderHook(() => usePlacementLabels({ ...options, details: [...options.details, page] }))
  await waitFor(() => expect(result.current.get(placementDetailKey(page))?.title).toBe('Landing title'))
  expect(result.current.get(placementDetailKey(page))?.href).toBe('/cms/collections/pages/7')
  expect(result.current.get(placementDetailKey(block))).toEqual({ title: 'Article', href: '/cms/collections/posts/123' })
  expect(result.current.get(placementDetailKey(noPath))).toEqual({ title: 'Another article', href: '/cms/collections/posts/456' })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls.map(call => call[0])).toContain('/api/xp/pages?collection=pages&path=%2Flanding')
  expect(fetcher.mock.calls.find(call => call[0].includes('/posts?'))?.[0]).toContain('where%5Bid%5D%5Bin%5D=123%2C456')
  rerender(); await act(async () => {})
  expect(fetcher).toHaveBeenCalledTimes(2)
})
test.each([403, 500, 200])('unreadable or missing lookups link known ids with path or neutral text (%s)', async status => {
  const fetcher = vi.fn(async () => json({ docs: [] }, status)); vi.stubGlobal('fetch', fetcher)
  const { result } = renderHook(() => usePlacementLabels(options))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(result.current.get(placementDetailKey(page))).toEqual({ title: '/landing' })
  expect(result.current.get(placementDetailKey(block))).toEqual({ title: '/post', href: '/cms/collections/posts/123' })
  expect(result.current.get(placementDetailKey(noPath))).toEqual({ title: 'This page', href: '/cms/collections/posts/456' })
  expect(result.current.get(placementDetailKey({}))).toEqual({ title: 'This page' })
})
test('results-only reader makes no requests, even for named collections and ids', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const { result } = renderHook(() => usePlacementLabels({ ...options, canManage: false }))
  expect(fetcher).not.toHaveBeenCalled()
  expect(result.current.get(placementDetailKey(block))).toEqual({ title: '/post', href: '/cms/collections/posts/123' })
})
test('a preflight title is preferred over a path and document links require an id', () => {
  expect(preflightPlacementLabel(page, { placements: [], pagePlacements: [{ ...page, arm: 'control', published: false, title: 'Named draft' }], checks: [], baseline: null, trafficPerDay: null, estimate: null }, '/cms')).toEqual({ title: 'Named draft' })
})

test('an in-flight lookup still fills the view cache when details change before its response', async () => {
  let finish!: (response: Response) => void
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', fetcher)
  const { result, rerender } = renderHook(({ details }) => usePlacementLabels({ ...options, details }), { initialProps: { details: [page] } })
  rerender({ details: [] })
  await act(async () => { finish(json({ docs: [{ id: 7, title: 'Finished lookup' }] })) })
  rerender({ details: [page] })
  expect(result.current.get(placementDetailKey(page))).toEqual({ title: 'Finished lookup', href: '/cms/collections/pages/7' })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('an omitted collection title field uses the path instead of an unrelated title field', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ docs: [{ id: 123, title: 'Unconfigured title' }] })))
  const { result } = renderHook(() => usePlacementLabels({ ...options, details: [block], collectionTitles: {} }))
  await act(async () => {})
  expect(result.current.get(placementDetailKey(block))).toEqual({ title: '/post', href: '/cms/collections/posts/123' })
})

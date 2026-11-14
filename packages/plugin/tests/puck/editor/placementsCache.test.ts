import { afterEach, expect, test, vi } from 'vitest'
import { acquirePlacements, subscribePlacements, readEditorPreflight, invalidatePlacements, cachedPreflight, placementsPending } from '../../../src/puck/editor/placementsCache.js'
afterEach(() => vi.unstubAllGlobals())
test('a failed read does not leave a settled cache hit', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Response.json({ placements: [] }))
  vi.stubGlobal('fetch', fetcher)
  const first = vi.fn()
  const releaseFirst = acquirePlacements('/api', 'unknown', first)
  await vi.waitFor(() => expect(placementsPending('/api', 'unknown')).toBe(false))
  expect(first).toHaveBeenCalledWith(undefined)
  const notify = vi.fn()
  const release = acquirePlacements('/api', 'unknown', notify)
  await vi.waitFor(() => expect(notify).toHaveBeenCalledWith([]))
  expect(fetcher).toHaveBeenCalledTimes(2)
  release(); releaseFirst()
})

test('failed placement discovery is unknown rather than an empty successful placement list', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ placements: [], checks: [{ code: 'no-placements', ok: false, detail: 'forbidden' }] })))
  const notify = vi.fn()
  const release = acquirePlacements('/api', 'failed', notify)
  await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(undefined))
  expect(notify).not.toHaveBeenCalledWith([])
  release()
})


test('drawer subscriptions never fetch on their own', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const notify = vi.fn()
  const release = subscribePlacements('/api', 'drawer-only', notify)
  expect(fetcher).not.toHaveBeenCalled()
  release()
})


test('a drawer read follows the shared post-write request instead of publishing stale readiness', async () => {
  const old = { placements: [], checks: [{ code: 'no-primary-metric', ok: false }] }
  const fresh = { placements: [], checks: [] }
  let finishOld!: (response: Response) => void
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockResolvedValue(Response.json(fresh))
  vi.stubGlobal('fetch', fetcher)
  const release = subscribePlacements('/api', 'drawer-race', () => {})
  const pending = readEditorPreflight('/api', 'drawer-race', new AbortController().signal)
  // The sidebar's successful PATCH invalidates a pre-write request.
  invalidatePlacements('/api', 'drawer-race')
  await vi.waitFor(() => expect(cachedPreflight('/api', 'drawer-race')).toEqual(fresh))
  finishOld(Response.json(old))
  expect(await (await pending).json()).toEqual(fresh)
  expect(cachedPreflight('/api', 'drawer-race')).toEqual(fresh)
  expect(fetcher).toHaveBeenCalledTimes(2)
  release()
})


test('post-drawer-save readiness supersedes a poll that began before the PATCH', async () => {
  let finishPoll!: (response: Response) => void
  const fresh = { placements: [], checks: [] }
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve }))
    .mockResolvedValue(Response.json(fresh))
  vi.stubGlobal('fetch', fetcher)
  const release = acquirePlacements('/api', 'drawer-save', () => {})
  // useTestDocument requests superseding readiness after a successful PATCH/reload.
  const savedRead = readEditorPreflight('/api', 'drawer-save', new AbortController().signal, true)
  expect(await (await savedRead).json()).toEqual(fresh)
  finishPoll(Response.json({ placements: [], checks: [{ code: 'no-primary-metric', ok: false }] }))
  await Promise.resolve()
  expect(cachedPreflight('/api', 'drawer-save')).toEqual(fresh)
  expect(fetcher).toHaveBeenCalledTimes(2)
  release()
})

import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createManifestCache } from '../../src/manifest/cache.js'
import type { Manifest } from '../../src/types/manifest.js'
import type { ManifestLoader } from '../../src/runtime/loaders.js'

const manifest = (revision = 1): Manifest => ({ v: 1, revision, experiments: [], flagDefaults: {}, archivedWinners: {}, archivedPages: {} })
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { vi.useRealTimers() })
const flush = async () => { await vi.advanceTimersByTimeAsync(0) }

test('cold start waits at most 1500ms, then late result populates the cache', async () => {
  let resolve!: (m: Manifest) => void
  const load = vi.fn(() => new Promise<Manifest>(r => { resolve = r }))
  const cache = createManifestCache(load)
  const first = cache.get(), second = cache.get()
  await vi.advanceTimersByTimeAsync(1500)
  expect(await first).toBeNull()
  expect(await second).toBeNull()
  expect(load).toHaveBeenCalledOnce()
  resolve(manifest())
  await flush()
  expect(await cache.get()).toEqual(manifest())
})
test('shares a fast cold load and serves cached data within TTL', async () => {
  const load = vi.fn(async () => manifest())
  const cache = createManifestCache(load)
  expect(await Promise.all([cache.get(), cache.get()])).toEqual([manifest(), manifest()])
  await vi.advanceTimersByTimeAsync(29_999)
  expect(await cache.get()).toEqual(manifest())
  expect(load).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
test('TTL refresh uses revision, shares in-flight and replaces cache when complete', async () => {
  let resolve!: (m: Manifest) => void
  const load = vi.fn<ManifestLoader>().mockResolvedValueOnce(manifest()).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const cache = createManifestCache(load)
  await cache.get()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(await cache.get()).toEqual(manifest())
  expect(await cache.get()).toEqual(manifest())
  expect(load).toHaveBeenCalledTimes(2)
  expect(load).toHaveBeenLastCalledWith({ ifRevision: 1 })
  resolve(manifest(2))
  await flush()
  expect(await cache.get()).toEqual(manifest(2))
})
test.each(['not-modified', 'reject', 'throw'] as const)('%s refresh retains last good and resets TTL', async mode => {
  const load = vi.fn<ManifestLoader>().mockResolvedValueOnce(manifest()).mockImplementationOnce(() => {
    if (mode === 'throw') throw new Error('offline')
    return mode === 'reject' ? Promise.reject(new Error('offline')) : Promise.resolve('not-modified')
  })
  const cache = createManifestCache(load, { ttlMs: 100 })
  await cache.get()
  await vi.advanceTimersByTimeAsync(100)
  await cache.get()
  await flush()
  expect(await cache.get()).toEqual(manifest())
  expect(load).toHaveBeenCalledTimes(2)
})
test('null refresh clears a withdrawn manifest', async () => {
  const load = vi.fn<ManifestLoader>().mockResolvedValueOnce(manifest()).mockResolvedValueOnce(null)
  const cache = createManifestCache(load, { ttlMs: 10 })
  await cache.get()
  await vi.advanceTimersByTimeAsync(10)
  await cache.get()
  await flush()
  expect(await cache.get()).toBeNull()
})
test('cold rejection returns null and retries after TTL', async () => {
  const load = vi.fn<ManifestLoader>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(manifest())
  let time = 0
  const cache = createManifestCache(load, { ttlMs: 10, now: () => time })
  expect(await cache.get()).toBeNull()
  time = 10
  expect(await cache.get()).toEqual(manifest())
})

test('a hung cold refresh expires at 5s and the next request retries immediately', async () => {
  const load = vi.fn<ManifestLoader>().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(manifest(2))
  const cache = createManifestCache(load)
  const cold = cache.get()
  await vi.advanceTimersByTimeAsync(1500)
  expect(await cold).toBeNull()
  await vi.advanceTimersByTimeAsync(3500)
  expect(await cache.get()).toEqual(manifest(2))
  expect(load).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

test('a hung warm refresh retains the last good manifest, retries, and ignores late settlement', async () => {
  let finish!: (value: Manifest) => void
  const load = vi.fn<ManifestLoader>().mockResolvedValueOnce(manifest())
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce(manifest(3))
  const cache = createManifestCache(load, { ttlMs: 100, refreshTimeoutMs: 250 })
  await cache.get()
  await vi.advanceTimersByTimeAsync(100)
  expect(await cache.get()).toEqual(manifest())
  await vi.advanceTimersByTimeAsync(250)
  expect(await cache.get()).toEqual(manifest())
  await flush()
  expect(await cache.get()).toEqual(manifest(3))
  finish(manifest(2))
  await flush()
  expect(await cache.get()).toEqual(manifest(3))
  expect(load).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
})

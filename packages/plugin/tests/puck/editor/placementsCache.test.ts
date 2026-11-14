import { afterEach, expect, test, vi } from 'vitest'
import { acquirePlacements, publishPlacements } from '../../../src/puck/editor/placementsCache.js'
afterEach(() => vi.unstubAllGlobals())
test('publishing unknown placements does not leave a settled cache hit', async () => {
  const fetcher = vi.fn(async () => Response.json({ placements: [] }))
  vi.stubGlobal('fetch', fetcher)
  publishPlacements('/api', 'unknown', undefined)
  const notify = vi.fn()
  const release = acquirePlacements('/api', 'unknown', notify)
  await vi.waitFor(() => expect(notify).toHaveBeenCalledWith([]))
  expect(fetcher).toHaveBeenCalledOnce()
  release()
})

test('failed placement discovery is unknown rather than an empty successful placement list', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ placements: [], checks: [{ code: 'no-placements', ok: false, detail: 'forbidden' }] })))
  const notify = vi.fn()
  const release = acquirePlacements('/api', 'failed', notify)
  await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(undefined))
  expect(notify).not.toHaveBeenCalledWith([])
  release()
})

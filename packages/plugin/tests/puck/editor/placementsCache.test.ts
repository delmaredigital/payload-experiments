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

import { afterEach, expect, test, vi } from 'vitest'
import { handleRecompute } from '../../src/endpoints/recompute.js'
import { runResults } from '../../src/server/runResults.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
vi.mock('../../src/server/runResults.js', () => ({ runResults: vi.fn() }))
afterEach(() => vi.resetAllMocks())

test('manage recompute runs in process for exactly the authorised experiment', async () => {
  const summary = { ran: 1, skipped: 0, swept: 0, processedIds: ['exp'], budgetExhausted: false }
  vi.mocked(runResults).mockResolvedValue(summary)
  const payload = fakePayload({ collections: { 'xp-experiments': [{ id: 'exp' }], 'xp-results-snapshots': [{ id: 'snapshot', experiment: 'exp', phase: 1, computedAt: '2026-10-31T00:00:00Z' }] } })
  const req = fakeReq({ payload, routeParams: { id: 'exp' }, method: 'POST' })
  const response = await handleRecompute(req, { options: sampleOptions() })
  expect(await response.json()).toEqual({ snapshotId: 'snapshot' })
  expect(runResults).toHaveBeenCalledWith(payload, { experimentId: 'exp' })
  expect(payload.calls[0]!.args).toMatchObject({ req, overrideAccess: false })
})

test('missing experiment is 404 and does not run analysis', async () => {
  expect((await handleRecompute(fakeReq({ routeParams: { id: 'unknown' } }), { options: sampleOptions() })).status).toBe(404)
  expect(runResults).not.toHaveBeenCalled()
})

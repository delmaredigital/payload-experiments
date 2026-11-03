import { safeError } from '../../src/log.js'
import { afterEach, expect, test, vi } from 'vitest'
import { handleRecompute } from '../../src/endpoints/recompute.js'
import { runResults } from '../../src/server/runResults.js'
import { newestSnapshotIds } from '../../src/db/snapshots.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
vi.mock('../../src/server/runResults.js', () => ({ runResults: vi.fn() }))
vi.mock('../../src/db/snapshots.js', async original => ({ ...await original<object>(), newestSnapshotIds: vi.fn() }))
afterEach(() => vi.resetAllMocks())

test('manage recompute runs in process for exactly the authorised experiment', async () => {
  const summary = { ran: 1, skipped: 0, failed: 0, swept: 0, processedIds: ['exp'], budgetExhausted: false }
  vi.mocked(runResults).mockResolvedValue(summary)
  vi.mocked(newestSnapshotIds).mockResolvedValue(['snapshot'])
  const payload = fakePayload({ collections: { 'xp-experiments': [{ id: 'exp' }], 'xp-results-snapshots': [{ id: 'snapshot', experiment: 'exp', phase: 1, computedAt: '2026-10-31T00:00:00Z' }] } })
  const req = fakeReq({ payload, routeParams: { id: 'exp' }, method: 'POST' })
  const response = await handleRecompute(req, { options: sampleOptions() })
  expect(await response.json()).toEqual({ snapshotId: 'snapshot' })
  expect(runResults).toHaveBeenCalledWith(payload, { experimentId: 'exp', sweep: false })
  expect(payload.calls[0]!.args).toMatchObject({ req, overrideAccess: false })
})

test.each(['skipped', 'budget', 'no-phase'])('recompute %s returns a distinct non-2xx error, never a null success', async outcome => {
  vi.mocked(runResults).mockResolvedValue({ ran: 0, skipped: outcome === 'skipped' ? 1 : 0, failed: 0, swept: 0, processedIds: [], budgetExhausted: outcome === 'budget' })
  vi.mocked(newestSnapshotIds).mockResolvedValue([])
  const req = fakeReq({ payload: fakePayload({ collections: { 'xp-experiments': [{ id: 'exp' }] } }), routeParams: { id: 'exp' } })
  const response = await handleRecompute(req, { options: sampleOptions() })
  expect(response.status).toBe(outcome === 'no-phase' ? 422 : 503)
  expect(await response.json()).toMatchObject({ errors: [{ code: 'recompute-failed' }] })
})

test('a snapshot read error is logged with its experiment and returns recompute-failed with HTTP 503', async () => {
  const error = new Error('Snapshot database unavailable')
  vi.mocked(runResults).mockResolvedValue({ ran: 1, skipped: 0, failed: 0, swept: 0, processedIds: ['exp'], budgetExhausted: false })
  vi.mocked(newestSnapshotIds).mockRejectedValue(error)
  const payload = fakePayload({ collections: { 'xp-experiments': [{ id: 'exp' }] } })
  const response = await handleRecompute(fakeReq({ payload, routeParams: { id: 'exp' } }), { options: sampleOptions() })
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ errors: [{ code: 'recompute-failed', message: 'Results could not be recomputed. Try again.' }] })
  expect(payload.logs).toContainEqual({ level: 'error', args: [{ err: safeError(error), experimentId: 'exp' }, expect.any(String)] })
})

test('missing experiment is 404 and does not run analysis', async () => {
  expect((await handleRecompute(fakeReq({ routeParams: { id: 'unknown' } }), { options: sampleOptions() })).status).toBe(404)
  expect(runResults).not.toHaveBeenCalled()
})

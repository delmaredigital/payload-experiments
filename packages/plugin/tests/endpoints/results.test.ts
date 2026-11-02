import { afterEach, expect, test, vi } from 'vitest'
import { handleResults } from '../../src/endpoints/results.js'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { resultsMetadata, newestSnapshotIds } from '../../src/db/snapshots.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
import type { Snapshot } from '../../src/types/snapshot.js'
import fixture from '../_fixtures/snapshots/T7.json'

vi.mock('../../src/db/snapshots.js', async original => ({ ...await original<object>(), resultsMetadata: vi.fn(), newestSnapshotIds: vi.fn() }))
afterEach(() => vi.resetAllMocks())
const options = sampleOptions()
const phase = (n: number, phaseKind = 'test') => ({ id: n, experiment: 'exp', phase: n, phaseKind,
  startedAt: '2026-10-01T00:00:00Z', endedAt: null,
  arms: [{ key: 'control', label: 'Original', kind: 'control' }, { key: 'variantA', label: 'Short form', kind: 'variant' }],
  metricDefinitions: [{ metricId: 'primary', name: 'Signup', kind: 'binomial', role: 'primary', resolvedCap: null, historyUnits: 0, capNotice: 'no-history' }],
})
const snap = (id: number, round: number, computedAt: string) => ({ id, experiment: 'exp', phase: round, computedAt,
  snapshot: { ...fixture, phase: round, computedAt } as unknown as Snapshot })

test('returns phase summaries and null snapshot before first run, passes req and access posture', async () => {
  vi.mocked(resultsMetadata).mockResolvedValue({ status: 'running', snapshotId: null, winnerArm: null })
  vi.mocked(newestSnapshotIds).mockResolvedValue([])
  const payload = fakePayload({ collections: { 'xp-phases': [phase(1)] } })
  const req = fakeReq({ payload, routeParams: { id: 'exp' }, url: 'http://localhost/results' })
  const response = await handleResults(req, { options })
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toMatchObject({ phases: [{ phase: 1, arms: [{ label: 'Original' }, { label: 'Short form' }], metrics: [{ capNotice: 'no-history' }] }], snapshot: null })
  expect(payload.calls.every(call => call.args.overrideAccess === false && call.args.req === req)).toBe(true)
})

test('decided defaults to decision round, retains decision snapshot and offers selected round series', async () => {
  vi.mocked(resultsMetadata).mockResolvedValue({ status: 'decided', snapshotId: 1, winnerArm: 'variantA' })
  vi.mocked(newestSnapshotIds).mockResolvedValue([2, 3])
  const payload = fakePayload({ collections: { 'xp-phases': [phase(1), phase(2, 'rollout')], 'xp-results-snapshots': [
    snap(1, 1, '2026-10-02T00:00:00Z'), snap(2, 1, '2026-10-03T00:00:00Z'), snap(3, 2, '2026-10-04T00:00:00Z'),
  ] } })
  const invoke = (query = '') => handleResults(fakeReq({ payload, routeParams: { id: 'exp' }, url: `http://localhost/results${query}` }), { options })
  const response = await (await invoke()).json()
  expect(response.snapshot.phase).toBe(1)
  expect(response.snapshot.computedAt).toBe('2026-10-03T00:00:00Z')
  expect(response.decisionSnapshot.computedAt).toBe('2026-10-02T00:00:00Z')
  expect(response.decision).toEqual({ phase: 1, winnerArm: 'variantA' })
  const snapshotReads = payload.calls.filter(call => call.args.collection === 'xp-results-snapshots')
  expect(snapshotReads).toHaveLength(1)
  expect(snapshotReads[0]!.args).toMatchObject({ limit: 3, where: { id: { in: [2, 3, 1] } } })
  const series = await (await invoke('?phase=1&series=1')).json()
  expect([...new Set(series.series.map((point: { computedAt: string }) => point.computedAt))]).toEqual(['2026-10-02T00:00:00Z', '2026-10-03T00:00:00Z'])
  expect((await (await invoke('?phase=2')).json()).snapshot.phase).toBe(2)
  expect((await invoke('?phase=99')).status).toBe(404)
  expect(await (await invoke('?phase=-1')).json()).toMatchObject({ errors: [{ code: 'invalid-body' }] })
})

test('decision uses the decision snapshot phase even when a later test round is selected', async () => {
  vi.mocked(resultsMetadata).mockResolvedValue({ status: 'decided', snapshotId: 1, winnerArm: 'variantA' })
  vi.mocked(newestSnapshotIds).mockResolvedValue([2])
  const payload = fakePayload({ collections: { 'xp-phases': [phase(3), phase(2, 'rollout'), phase(1)],
    'xp-results-snapshots': [snap(1, 1, '2026-10-02T00:00:00Z'), snap(2, 3, '2026-10-04T00:00:00Z')] } })
  const response = await handleResults(fakeReq({ payload, routeParams: { id: 'exp' }, url: 'http://localhost/results?phase=3' }), { options })
  expect(await response.json()).toMatchObject({ snapshot: { phase: 3 }, decision: { phase: 1, winnerArm: 'variantA' } })
})

test.each([null, 99])('decision without an available decision snapshot (%s) uses the last test round', async snapshotId => {
  vi.mocked(resultsMetadata).mockResolvedValue({ status: 'decided', snapshotId, winnerArm: 'variantB' })
  vi.mocked(newestSnapshotIds).mockResolvedValue([])
  const payload = fakePayload({ collections: { 'xp-phases': [phase(4, 'rollout'), phase(1), phase(3), phase(2, 'rollout')] } })
  const response = await handleResults(fakeReq({ payload, routeParams: { id: 'exp' }, url: 'http://localhost/results?phase=1' }), { options })
  const body = await response.json()
  expect(body.decision).toEqual({ phase: 3, winnerArm: 'variantB' })
  expect(body).not.toHaveProperty('decisionSnapshot')
})

test.each([null, ''])('no winner (%s) omits the decision key even with a decision snapshot', async winnerArm => {
  vi.mocked(resultsMetadata).mockResolvedValue({ status: 'running', snapshotId: 1, winnerArm })
  vi.mocked(newestSnapshotIds).mockResolvedValue([1])
  const payload = fakePayload({ collections: { 'xp-phases': [phase(1)], 'xp-results-snapshots': [snap(1, 1, '2026-10-02T00:00:00Z')] } })
  const response = await handleResults(fakeReq({ payload, routeParams: { id: 'exp' } }), { options })
  expect(await response.json()).not.toHaveProperty('decision')
})

test.each([{ records: [] }, { records: [phase(1, 'rollout')] }])('winner without a decision snapshot or test round omits the decision key ($records)', async ({ records }) => {
  vi.mocked(resultsMetadata).mockResolvedValue({ status: 'decided', snapshotId: null, winnerArm: 'variantA' })
  vi.mocked(newestSnapshotIds).mockResolvedValue([])
  const payload = fakePayload({ collections: { 'xp-phases': records } })
  const response = await handleResults(fakeReq({ payload, routeParams: { id: 'exp' } }), { options })
  expect(await response.json()).not.toHaveProperty('decision')
})

test('a readResults-only caller gets the decision through the gated endpoint', async () => {
  const readerOptions = sampleOptions()
  readerOptions.access = { manage: vi.fn(() => false), readResults: vi.fn(() => true) }
  vi.mocked(resultsMetadata).mockResolvedValue({ status: 'decided', snapshotId: null, winnerArm: 'variantA' })
  vi.mocked(newestSnapshotIds).mockResolvedValue([])
  const payload = fakePayload({ collections: { 'xp-phases': [phase(1), phase(2, 'rollout')] } })
  const req = fakeReq({ payload, user: { id: 'reader' }, routeParams: { id: 'exp' } })
  const endpoint = buildEndpoints({ options: readerOptions }).find(route => route.path === '/xp/experiments/:id/results')!
  const response = await endpoint.handler(req)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ decision: { phase: 1, winnerArm: 'variantA' } })
  expect(readerOptions.access.readResults).toHaveBeenCalledWith({ req })
  expect(readerOptions.access.manage).not.toHaveBeenCalled()
  expect(payload.calls.every(call => call.args.collection !== 'xp-experiments' && call.args.overrideAccess === false && call.args.req === req)).toBe(true)
})

test.each(['', 'abc', '-1', '0', '1.2', '9007199254740992'])('ill-typed phase=%s is 400 invalid-body before database reads', async phase => {
  const response = await handleResults(fakeReq({ routeParams: { id: 'exp' }, url: `http://localhost/results?phase=${phase}` }), { options })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ errors: [{ code: 'invalid-body' }] })
  expect(resultsMetadata).not.toHaveBeenCalled()
})

test('unknown experiment returns 404', async () => {
  vi.mocked(resultsMetadata).mockResolvedValue(null)
  expect((await handleResults(fakeReq({ routeParams: { id: 'missing' } }), { options })).status).toBe(404)
})

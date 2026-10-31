import { afterEach, expect, test, vi } from 'vitest'
import { handleResults } from '../../src/endpoints/results.js'
import { resultsMetadata } from '../../src/db/snapshots.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
import type { Snapshot } from '../../src/types/snapshot.js'
import fixture from '../_fixtures/snapshots/T7.json'

vi.mock('../../src/db/snapshots.js', async original => ({ ...await original<object>(), resultsMetadata: vi.fn() }))
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
  vi.mocked(resultsMetadata).mockResolvedValue({ status: 'running', snapshotId: null })
  const payload = fakePayload({ collections: { 'xp-phases': [phase(1)] } })
  const req = fakeReq({ payload, routeParams: { id: 'exp' }, url: 'http://localhost/results' })
  const response = await handleResults(req, { options })
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toMatchObject({ phases: [{ phase: 1, arms: [{ label: 'Original' }, { label: 'Short form' }], metrics: [{ capNotice: 'no-history' }] }], snapshot: null })
  expect(payload.calls.every(call => call.args.overrideAccess === false && call.args.req === req)).toBe(true)
})

test('decided defaults to decision round, retains decision snapshot and offers selected round series', async () => {
  vi.mocked(resultsMetadata).mockResolvedValue({ status: 'decided', snapshotId: 1 })
  const payload = fakePayload({ collections: { 'xp-phases': [phase(1), phase(2, 'rollout')], 'xp-results-snapshots': [
    snap(1, 1, '2026-10-02T00:00:00Z'), snap(2, 1, '2026-10-03T00:00:00Z'), snap(3, 2, '2026-10-04T00:00:00Z'),
  ] } })
  const invoke = (query = '') => handleResults(fakeReq({ payload, routeParams: { id: 'exp' }, url: `http://localhost/results${query}` }), { options })
  const response = await (await invoke()).json()
  expect(response.snapshot.phase).toBe(1)
  expect(response.snapshot.computedAt).toBe('2026-10-03T00:00:00Z')
  expect(response.decisionSnapshot.computedAt).toBe('2026-10-02T00:00:00Z')
  const series = await (await invoke('?phase=1&series=1')).json()
  expect([...new Set(series.series.map((point: { computedAt: string }) => point.computedAt))]).toEqual(['2026-10-02T00:00:00Z', '2026-10-03T00:00:00Z'])
  expect((await (await invoke('?phase=2')).json()).snapshot.phase).toBe(2)
  expect((await invoke('?phase=99')).status).toBe(404)
  expect(await (await invoke('?phase=-1')).json()).toMatchObject({ errors: [{ code: 'invalid-phase' }] })
})

test('unknown experiment returns 404', async () => {
  vi.mocked(resultsMetadata).mockResolvedValue(null)
  expect((await handleResults(fakeReq({ routeParams: { id: 'missing' } }), { options })).status).toBe(404)
})

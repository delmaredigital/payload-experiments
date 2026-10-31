import { expect, test, vi } from 'vitest'
import { preflightData, loadStartInputs } from '../../src/transitions/preflightData.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'
import { sampleOptions } from '../collections/fixtures.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'

const now = new Date('2026-10-30T12:00:00Z')
const rows = [
  { unitId: 'a', value: 2, ts: new Date('2026-10-10') },
  { unitId: 'a', value: 4, ts: new Date('2026-10-11') },
  { unitId: 'b', value: 10, ts: new Date('2026-10-12') },
]
function setup(kind: 'binomial' | 'count' | 'revenue' = 'binomial', reach: number | null = 100) {
  const options = sampleOptions()
  const query = vi.fn(async () => rows)
  options.metricSources!.find(source => source.id === kind)!.query = query
  const payload = fakePayload({ collections: {
    'xp-experiments': [{ id: 1, slug: 'hero', kind: 'code', status: 'draft', unitType: 'visitor', arms: defaultArms('code'), allocation: 50,
      exposurePolicy: 'manual', metrics: { primary: 2 }, analysis: { plannedDurationDays: 14, reachPerDay: reach } }],
    'xp-metrics': [{ id: 2, source: kind }],
  } })
  return { options, payload, query, req: fakeReq({ payload }) }
}
test.each(['binomial', 'count', 'revenue'] as const)('28-day %s baseline aggregates distinct eventful units', async kind => {
  const { options, req, query, payload } = setup(kind)
  const result = await preflightData(req, { experimentId: 1, options }, { now, estimate: () => ({ weeks: [], sampleSizeAndRuntime: {} }) })
  expect(result!.baseline).toEqual({ metricId: 2, value: kind === 'binomial' ? 3 / 28 : 8, days: 28 })
  expect(query).toHaveBeenCalledWith({ from: new Date('2026-10-02T12:00:00Z'), to: now })
  expect(result!.trafficPerDay).toBe(100)
  expect(payload.calls.every(call => call.method === 'find' && call.args.overrideAccess === false && call.args.req === req)).toBe(true)
  expect(payload.dbCalls).toEqual([])
})
test('source failure or missing source returns null baseline, without throwing', async () => {
  const { options, req, query } = setup()
  query.mockRejectedValueOnce(new Error('host unavailable'))
  expect((await preflightData(req, { experimentId: 1, options }, { now }))!.baseline).toBeNull()
  options.metricSources = []
  expect((await preflightData(req, { experimentId: 1, options }, { now }))!.baseline).toBeNull()
})
test('empty history yields a zero baseline; out-of-window rows are ignored', async () => {
  const { options, req, query } = setup()
  query.mockResolvedValueOnce([])
  expect((await preflightData(req, { experimentId: 1, options }, { now }))!.baseline?.value).toBe(0)
  query.mockResolvedValueOnce([...rows, { unitId: 'a', value: 20, ts: new Date('2026-10-10T17:00:00Z') }, { unitId: 'old', value: 1, ts: new Date('2026-10-01') }, { unitId: 'end', value: 1, ts: now }])
  expect((await preflightData(req, { experimentId: 1, options }, { now }))!.baseline?.value).toBe(3 / 28)
})
test('injected estimate receives enrolled traffic, method, primary moments and pair tuning', async () => {
  const { options, req } = setup()
  const estimate = vi.fn(() => ({ weeks: [], sampleSizeAndRuntime: { primary: { weeks: 3, users: 1050 } } }))
  const result = await preflightData(req, { experimentId: 1, options }, { now, estimate })
  expect(estimate).toHaveBeenCalledWith({ metrics: { primary: { type: 'binomial', conversionRate: (3 / 28) / 100, effectSize: 0.1 } },
    usersPerWeek: 350, nVariations: 2, nWeeks: 13, alpha: 0.05, targetPower: 0.8, method: { type: 'frequentist', sequentialTesting: 700 } })
  expect(result!.estimate).toEqual({ weeks: 3, plannedDurationDays: 14, sequentialTuningParameter: 700, feasible: true })
})
test('unequal arms and holdout do not inflate planning traffic; tuning uses control plus one variant', async () => {
  const { options, req, payload } = setup('count')
  payload.documents['xp-experiments']![0]!.arms = [
    { ...defaultArms('code')[0], weight: 40 }, { ...defaultArms('code')[1], weight: 20 },
    { key: 'variantB', kind: 'variant', label: 'B', weight: 20 }, { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 20 },
  ]
  const estimate = vi.fn(() => ({ weeks: [], sampleSizeAndRuntime: {} }))
  const result = await preflightData(req, { experimentId: 1, options }, { now, estimate })
  expect(estimate.mock.calls[0]).toBeDefined()
  expect(estimate).toHaveBeenCalledWith(expect.objectContaining({ usersPerWeek: 210, nVariations: 3, alpha: 0.025, method: { type: 'frequentist', sequentialTesting: 420 } }))
  expect(result!.estimate!.feasible).toBe(false)
})
test('unknown traffic and unavailable baseline suppress estimates; estimate exceptions are tolerated', async () => {
  const { options, req } = setup('binomial', null)
  const estimate = vi.fn(() => { throw new Error('power unavailable') })
  expect((await preflightData(req, { experimentId: 1, options }, { now, estimate }))!.estimate).toBeNull()
  expect(estimate).not.toHaveBeenCalled()
  const known = setup()
  expect((await preflightData(known.req, { experimentId: 1, options: known.options }, { now, estimate }))!.estimate).toBeNull()
})
test('default estimator uses the stats engine and returns finite JSON', async () => {
  const { options, req } = setup()
  const result = await preflightData(req, { experimentId: 1, options }, { now })
  expect(result!.estimate).toMatchObject({ weeks: expect.any(Number), feasible: expect.any(Boolean) })
  expect(JSON.parse(JSON.stringify(result))).toEqual(result)
})
test('gathers layer usage and point occupancy through paged, access-checked reads', async () => {
  const options = sampleOptions()
  options.flagPoints![0]!.placements = async () => [{ arm: 'control', ok: true }, { arm: 'variantA', ok: true }]
  const findGlobal = vi.fn(async () => ({ flagDefaults: { cta: { params: { title: 'Effective' } } } }))
  const payload = fakePayload({ overrides: { findGlobal }, collections: {
    'xp-experiments': [
      { id: 1, slug: 'hero', kind: 'flag', flagPoint: 'cta', layer: 3, status: 'draft', unitType: 'user', arms: defaultArms('flag'), allocation: 50 },
      ...Array.from({ length: 101 }, (_, n) => ({ id: n + 2, layer: 3, status: 'running', flagPoint: 'cta', layerSlices: [n % 100] })),
    ], 'xp-layers': [{ id: 3, unitType: 'user' }],
  } })
  const req = fakeReq({ payload })
  const input = await loadStartInputs(req, options, 1)
  expect(input!.layer?.usedSlices).toHaveLength(101)
  expect(input!.flagPointBusy).toBe(true)
  expect(input!.experiment.arms[0]!.params).toEqual({ title: 'Effective' })
  expect(findGlobal).toHaveBeenCalledWith({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
  expect(payload.calls.some(call => call.args.page === 2)).toBe(true)
  expect(payload.calls.every(call => call.args.overrideAccess === false && call.args.req === req)).toBe(true)
})

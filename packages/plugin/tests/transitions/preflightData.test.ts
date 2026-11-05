import { expect, test, vi } from 'vitest'
import type { PowerWeeksInput } from '@delmaredigital/experiments-stats'
import { preflightData, loadStartInputs, loadStartInputsBatch, loadPageTestsInUse } from '../../src/transitions/preflightData.js'
import { createFakeExecutor } from '../_fakes/executor.js'
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
function setup(kind: 'binomial' | 'count' | 'revenue' = 'binomial', reach: number | null = 100, executor = createFakeExecutor()) {
  const options = sampleOptions()
  const query = vi.fn(async () => rows)
  options.metricSources!.find(source => source.id === kind)!.query = query
  const payload = fakePayload({ executor, collections: {
    'xp-experiments': [{ id: 1, slug: 'hero', kind: 'code', status: 'draft', unitType: 'visitor', arms: defaultArms('code'), allocation: 50,
      exposurePolicy: 'manual', metrics: { primary: 2 }, analysis: { plannedDurationDays: 14, reachPerDay: reach } }],
    'xp-metrics': [{ id: 2, source: kind }],
  } })
  return { options, payload, query, executor, req: fakeReq({ payload }) }
}
test.each(['binomial', 'count', 'revenue'] as const)('28-day %s baseline aggregates distinct eventful units', async kind => {
  const { options, req, query, payload } = setup(kind)
  const result = await preflightData(req, { experimentId: 1, options }, { now, estimate: () => ({ weeks: [], sampleSizeAndRuntime: {} }) })
  expect(result!.baseline).toEqual({ metricId: 2, value: kind === 'binomial' ? (3 / 28) / 100 : 8, days: 28 })
  expect(query).toHaveBeenCalledWith({ from: new Date('2026-10-02T12:00:00Z'), to: now })
  expect(result!.trafficPerDay).toBe(100)
  if (kind === 'binomial') {
    expect(result!.baseline!.value).toBeGreaterThan(0)
    expect(result!.baseline!.value).toBeLessThan(1)
  }
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
  expect((await preflightData(req, { experimentId: 1, options }, { now }))!.baseline?.value).toBe((3 / 28) / 100)
})
test('injected estimate receives enrolled traffic, method, primary moments and pair tuning', async () => {
  const { options, req } = setup()
  const estimate = vi.fn(() => ({ weeks: [], sampleSizeAndRuntime: { primary: { weeks: 3, users: 1050 } } }))
  const result = await preflightData(req, { experimentId: 1, options }, { now, estimate })
  expect(estimate).toHaveBeenCalledWith({ metrics: { primary: { type: 'binomial', conversionRate: (3 / 28) / 100, effectSize: 0.1 } },
    usersPerWeek: 350, nVariations: 2, nWeeks: 13, alpha: 0.05, targetPower: 0.8, method: { type: 'frequentist', sequentialTesting: 700 } })
  expect(result!.estimate).toEqual({ weeks: 3, plannedDurationDays: 21, sequentialTuningParameter: 1050, feasible: true })
  expect(estimate).toHaveBeenCalledTimes(2)
})
test('unsaved duration is estimated once, then final tuning matches the returned prefill', async () => {
  const { options, req, payload } = setup()
  payload.documents['xp-experiments']![0]!.analysis = { reachPerDay: 100 }
  const estimate = vi.fn((_input: PowerWeeksInput) => ({ weeks: [], sampleSizeAndRuntime: { primary: { weeks: 4, users: 1400 } } }))
    .mockReturnValueOnce({ weeks: [], sampleSizeAndRuntime: { primary: { weeks: 3, users: 1050 } } })
  const result = await preflightData(req, { experimentId: 1, options }, { now, estimate })
  expect(estimate).toHaveBeenCalledTimes(2)
  expect(result!.estimate).toEqual({ weeks: 4, plannedDurationDays: 21, sequentialTuningParameter: 1050, feasible: true })
  expect(estimate.mock.calls[0]![0].method).toEqual({ type: 'frequentist', sequentialTesting: 700 })
  expect(estimate.mock.calls[1]![0].method).toEqual({ type: 'frequentist', sequentialTesting: result!.estimate!.sequentialTuningParameter })
})
test.each(['count', 'revenue'] as const)('%s baseline remains available when traffic is unknown', async kind => {
  const { options, req } = setup(kind, null)
  const result = await preflightData(req, { experimentId: 1, options }, { now })
  expect(result!.baseline).toEqual({ metricId: 2, value: 8, days: 28 })
  expect(result!.trafficPerDay).toBeNull()
  expect(result!.estimate).toBeNull()
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
  const unknown = await preflightData(req, { experimentId: 1, options }, { now, estimate })
  expect(unknown!.estimate).toBeNull()
  expect(unknown!.baseline).toBeNull()
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

test('a binomial rate of 1 or more (reachPerDay below the converters) gives no baseline and no estimate', async () => {
  const { options, req } = setup('binomial', 0.05)
  const estimate = vi.fn()
  const result = await preflightData(req, { experimentId: 1, options }, { now, estimate })
  expect(result!.baseline).toBeNull()
  expect(result!.estimate).toBeNull()
  expect(estimate).not.toHaveBeenCalled()
})


test('page drafts share one SQL occupancy scan with no Local API occupancy read', async () => {
  const occupancy = Array.from({ length: 101 }, (_, n) => ({
    id: n + 2, arms: defaultArms('page').map(arm => ({ ...arm, pageTarget: n === 100 ? '/shared/' : `/page-${n}` })),
  }))
  const executor = createFakeExecutor({ results: [{ rows: occupancy }] })
  const { req, payload, options } = setup('binomial', 100, executor)
  const draft = payload.documents['xp-experiments']![0]!
  Object.assign(draft, { kind: 'page', arms: defaultArms('page').map(arm => ({ ...arm, pageTarget: '/shared' })) })
  const peer = { ...draft, id: 200, slug: 'second' }
  payload.documents['xp-experiments']!.push(peer)
  const inputs = await loadStartInputsBatch(req, options, [draft, peer] as unknown as import('../../src/transitions/checkStart.js').StartExperiment[])
  expect(inputs.get('1')!.pageTestsInUse).toHaveLength(101)
  expect(inputs.get('200')!.pageTestsInUse).toBe(inputs.get('1')!.pageTestsInUse)
  expect(executor.calls).toHaveLength(1)
  expect(executor.calls[0]!.text).toContain('JOIN LATERAL')
  expect(payload.calls.filter(call => call.args.collection === 'xp-experiments' || call.args.collection === 'xp-phases')).toEqual([])
})


test.each([false, true])('occupancy uses the request session with a promised transaction id: %s', async promised => {
  const pool = createFakeExecutor({ results: [{ rows: [{ id: 2, arms: [] }] }] })
  const session = createFakeExecutor({ results: [{ rows: [{ id: 3, arms: defaultArms('page') }] }] })
  const payload = fakePayload({ executor: pool })
  const req = session.withSession({ payload, transactionID: 'occupancy-tx' })
  if (promised) req.transactionID = Promise.resolve('occupancy-tx')
  expect(await loadPageTestsInUse(req)).toEqual([{ id: 3, arms: defaultArms('page') }])
  expect(session.calls).toHaveLength(1)
  expect(pool.calls).toEqual([])
  expect(payload.calls).toEqual([])
})

test('occupancy without a transaction uses the pool with no Local API read', async () => {
  const executor = createFakeExecutor({ results: [{ rows: [{ id: 2, arms: defaultArms('page') }] }] })
  const payload = fakePayload({ executor })
  expect(await loadPageTestsInUse(fakeReq({ payload }))).toEqual([{ id: 2, arms: defaultArms('page') }])
  expect(executor.calls).toHaveLength(1)
  expect(payload.calls).toEqual([])
})

test('occupancy with a missing transaction session throws without falling back to the pool', async () => {
  const executor = createFakeExecutor()
  const payload = fakePayload({ executor })
  const req = fakeReq({ payload, transactionID: 'missing-session' })
  await expect(loadPageTestsInUse(req)).rejects.toMatchObject({ name: 'XpNoTransactionError' })
  expect(executor.calls).toEqual([])
  expect(payload.calls).toEqual([])
})

test.each(['flag', 'code', 'page'] as const)('no goalNotes for an uninspectable %s test', async kind => {
  const { options, payload, req } = setup()
  Object.assign(payload.documents['xp-experiments']![0]!, { kind, pageCollection: 'pages' })
  payload.documents['xp-metrics']![0]!.source = 'click:join'
  options.pages = { collections: [{ slug: 'pages', pathOf: () => '/', findByPath: async () => ({ id: 7, published: true }) }] }
  expect((await preflightData(req, { experimentId: 1, options }, { now }))!.goalNotes ?? []).toEqual([])
}, 5_000) // Measured 1 ms locally; cap exceeds 3×.

test.each([false, true])('outside goalNotes require a completely readable placement (unchecked: %s)', async unchecked => {
  const { options, payload, req } = setup()
  Object.assign(payload.documents['xp-experiments']![0]!, { kind: 'page', pageCollection: 'pages', arms: defaultArms('page').map((arm, i) => ({ ...arm, pageTarget: i ? '/b' : '/a' })) })
  payload.documents['xp-metrics']![0]!.source = 'click:join'
  payload.documents.pages = [{ id: 7, layout: [] }]
  options.pages = { collections: [{ slug: 'pages', pathOf: () => '/', findByPath: async () => ({ id: 7, published: true }), contentOf: doc => doc.layout }] }
  if (unchecked) vi.spyOn(payload.db, 'findOne').mockRejectedValue(new Error('unreadable'))
  expect((await preflightData(req, { experimentId: 1, options }, { now }))!.goalNotes).toEqual(unchecked ? [] : [
    { metricId: 2, message: "This goal isn't inside the part being tested, so every version shows it the same way." },
  ])
}, 5_000) // Measured 3 ms locally; cap exceeds 3×.


test.each(['primary', 'guardrail'] as const)('preflight judges readable arms with one unchecked page for a %s goal', async role => {
  for (const disagree of [true, false]) {
    const f = setup()
    Object.assign(f.payload.documents['xp-experiments']![0]!, { kind: 'page', exposurePolicy: 'pageview', pageCollection: 'pages',
      metrics: role === 'primary' ? { primary: 2 } : { primary: 3, guardrails: [2] },
      arms: [...defaultArms('page').map((arm, i) => ({ ...arm, weight: i ? 33 : 34, pageTarget: i ? '/b' : '/a' })),
        { key: 'variantB', kind: 'variant', label: 'B', weight: 33, pageTarget: '/unreadable' }] })
    Object.assign(f.payload.documents['xp-metrics']![0]!, { source: 'click:join', name: 'Join' })
    f.payload.documents['xp-metrics']!.push({ id: 3, source: 'events:signup' })
    f.payload.documents.pages = [{ id: 7, layout: [{ xpGoal: 'join' }] }, { id: 8, layout: disagree ? [] : [{ xpGoal: 'join' }] }]
    const find = f.payload.db.findOne.bind(f.payload.db)
    vi.spyOn(f.payload.db, 'findOne').mockImplementation(async args => {
      if ((args.where?.id as { equals?: number })?.equals === 9) throw new Error('unreadable')
      return find(args)
    })
    f.options.pages = { collections: [{ slug: 'pages', pathOf: () => '/', findByPath: async path => ({ id: path === '/a' ? 7 : path === '/b' ? 8 : 9, published: true }), contentOf: doc => doc.layout }] }
    const result = (await preflightData(f.req, { experimentId: 1, options: f.options }, { now }))!
    expect(result.checks.filter(c => !c.ok).map(c => c.code)).toEqual(disagree ? ['goal-in-some-versions'] : [])
    expect(result.checks).toContainEqual({ code: 'placement-unchecked', ok: true, warning: true, detail: { collection: 'pages', path: '/unreadable' } })
    expect(result.goalNotes).toEqual([])
  }
}, 5_000) // Measured 2 ms locally; cap exceeds 3×.

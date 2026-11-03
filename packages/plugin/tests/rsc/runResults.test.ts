import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { hash, rolloutBucketRanges } from '@delmaredigital/experiments-stats'
import { pooledExecutor } from '../../src/db/executor.js'
import { resultsCandidates } from '../../src/db/snapshots.js'
import * as snapshotDb from '../../src/db/snapshots.js'
import { insertEvents, type EventRow } from '../../src/db/events.js'
import { insertIdentity } from '../../src/db/identities.js'
import { runResults } from '../../src/server/runResults.js'
import { handleRecompute } from '../../src/endpoints/recompute.js'
import type { Snapshot } from '../../src/types/snapshot.js'
import * as snapshotAnalysis from '../../src/results/snapshot.js'
import type { ResultsPhase } from '../../src/db/snapshots.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { xp_experiments, xp_phases, xp_results_snapshots } from '../_fixtures/generated-schema.js'

// Only the connection transport is replaced. Scheduling, readers, aggregation,
// analysis, snapshot inserts and sweep all execute against the generated schema.
vi.mock('../../src/db/snapshots.js', async original => ({ ...await original<object>(),
  resultsExecutor: (payload: Payload) => pooledExecutor(payload),
}))
let database: Awaited<ReturnType<typeof createPgliteDb>>
const start = Date.parse('2026-10-01T00:00:00Z'), now = start + 2 * 86_400_000
let serial = 0
beforeAll(async () => { database = await createPgliteDb() }, 60_000)
afterAll(async () => { await database?.close() })
afterEach(async () => { vi.restoreAllMocks(); await database.db.delete(xp_results_snapshots); await database.db.delete(xp_phases); await database.db.delete(xp_experiments) })

function payload() {
  const options = sampleOptions()
  const result = fakePayload({ config: { custom: { xp: options } }, overrides: { db: { drizzle: database.db } } })
  return { payload: result, options }
}
async function seed(unitType: 'visitor' | 'user' = 'visitor', overrides: Partial<ResultsPhase> = {}) {
  const [experiment] = await database.db.insert(xp_experiments).values({ name: 'Frozen', slug: `frozen-${++serial}`, kind: 'code', status: 'running', exposurePolicy: 'manual', unitType,
    analysis_method: 'bayesian', analysis_attributionWindowHours: 1 }).returning()
  const phase: ResultsPhase = { experiment: experiment!.id, phase: 1, phaseKind: 'test', startedAt: new Date(start).toISOString(), seed: 'frozen|', allocation: 100,
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50 }, { key: 'variantA', label: 'Variant', kind: 'variant', weight: 50 }],
    analysis: { method: 'sequential', cuped: 'off', sequentialTuningParameter: 5000, plannedDurationDays: 14, minExposuresPerArm: 200 },
    metricDefinitions: [{ metricId: 'signup', name: 'Frozen signup', kind: 'binomial', role: 'primary', source: 'events:signup', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150 }],
    ...overrides,
  }
  await database.db.insert(xp_phases).values({ ...phase, experiment: experiment!.id, startedAt: String(phase.startedAt), endedAt: phase.endedAt == null ? null : String(phase.endedAt),
    arms: [...phase.arms], analysis: phase.analysis, metricDefinitions: phase.metricDefinitions })
  return phase
}
async function events(phase: ResultsPhase, rows: Partial<EventRow>[]) {
  await insertEvents(pooledExecutor(payload().payload), rows.map((row, i) => ({ type: 'exposure', experimentId: phase.experiment, phase: phase.phase,
    arm: i % 2 ? 'variantA' : 'control', unitId: `unit-${phase.experiment}-${i}`, unitType: 'visitor', ts: new Date(start + 1000).toISOString(), dedupeKey: `run-${++serial}`, ...row })))
}
async function snapshots() { return database.db.select().from(xp_results_snapshots) }

async function freshBlockTest(tuning: number | null | undefined) {
  vi.spyOn(Date, 'now').mockReturnValue(now + 3 * 3_600_000)
  const phase = await seed('visitor', { startedAt: new Date(now).toISOString(),
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 45 },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 45 },
      { key: 'variantB', label: 'Variant B', kind: 'variant', weight: 10 }],
  })
  await database.db.update(xp_experiments).set({ kind: 'block', exposurePolicy: 'render', allocation: 100, analysis_method: 'sequential' })
    .where(eq(xp_experiments.id, Number(phase.experiment)))
  // Start copies the optional collection field as-is into the frozen JSON.
  // Unlike the existing fixture's explicit 5000, a new test can have no tuning.
  const { sequentialTuningParameter: _fixtureTuning, ...analysis } = phase.analysis
  await database.db.update(xp_phases).set({ analysis: { ...analysis,
    ...(tuning === undefined ? {} : { sequentialTuningParameter: tuning }),
  } }).where(eq(xp_phases.experiment, Number(phase.experiment)))
  expect(await snapshots()).toHaveLength(0)
  return phase
}

function expectFiniteNumbers(value: unknown, path = 'snapshot'): void {
  if (typeof value === 'number') expect(Number.isFinite(value), path).toBe(true)
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) expectFiniteNumbers(child, `${path}.${key}`)
  }
}

async function expectCollectingSnapshot(tuning: number | null | undefined) {
  const rows = await snapshots()
  expect(rows).toHaveLength(1)
  const snapshot = rows[0]!.snapshot as Snapshot
  expect(snapshot).toMatchObject({ verdict: { code: 'collecting' }, exposures: { total: 0, perArm: { control: 0, variantA: 0, variantB: 0 } } })
  expectFiniteNumbers(snapshot)
  expect(snapshot.params.sequentialTuningParameter).toBe(tuning ?? 5000)
  return rows[0]!
}

test.each([undefined, null, 1234])('hourly run stores a collecting snapshot for a fresh three-arm block test with no data and tuning %s', async tuning => {
  const phase = await freshBlockTest(tuning)
  const context = payload()
  const assembled = vi.spyOn(snapshotAnalysis, 'assembleSnapshot')
  const result = await runResults(context.payload)
  // Inspect before JSON serialization too: JSON.stringify turns NaN into null.
  const candidate = assembled.mock.calls[0]![0]
  expectFiniteNumbers(candidate)
  expect(candidate.params.sequentialTuningParameter).toBe(tuning ?? 5000)
  expect(result).toMatchObject({ ran: 1, skipped: 0, processedIds: [phase.experiment], budgetExhausted: false })
  expect(context.payload.logs.filter(log => log.level === 'error')).toEqual([])
  await expectCollectingSnapshot(tuning)
})

test.each([undefined, null, 1234])('recompute returns 200 and stores a finite collecting snapshot before the first exposure with tuning %s', async tuning => {
  const phase = await freshBlockTest(tuning)
  const context = payload()
  Object.assign(context.payload.db, { defaultIDType: 'number' })
  context.payload.documents['xp-experiments'] = [{ id: phase.experiment }]
  const find = context.payload.find.bind(context.payload)
  // Local API reads remain access-checked; their documents come from the same
  // in-process database used by real scheduling, analysis and snapshot writes.
  vi.spyOn(context.payload, 'find').mockImplementation(async args => {
    if (args.collection === 'xp-results-snapshots') context.payload.documents[args.collection] = await snapshots()
    return find(args)
  })
  const req = fakeReq({ payload: context.payload, routeParams: { id: String(phase.experiment) }, method: 'POST' })
  const response = await handleRecompute(req, { options: context.options })
  expect(response.status).toBe(200)
  const stored = await expectCollectingSnapshot(tuning)
  expect(await response.json()).toEqual({ snapshotId: stored.id })
})

test('frozen config, exposure denominator, multi-arm exclusion and strict endedAt survive live edits', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { endedAt: new Date(start + 86_400_000).toISOString() })
  await events(phase, [{ unitId: 'a' }, { unitId: 'b' }, { unitId: 'multi' }, { unitId: 'multi' },
    { unitId: 'late', ts: String(phase.endedAt) }, { unitId: 'b', arm: 'control', ts: String(phase.endedAt) },
    { type: 'conversion', unitId: 'a', eventName: 'signup', value: 1, ts: new Date(start + 2 * 3_600_000).toISOString() },
    { type: 'conversion', unitId: 'b', eventName: 'signup', value: 1, ts: String(phase.endedAt) }])
  const context = payload()
  expect(await runResults(context.payload)).toMatchObject({ ran: 1, skipped: 0, processedIds: [phase.experiment], budgetExhausted: false })
  const snapshot = (await snapshots())[0]!.snapshot as import('../../src/types/snapshot.js').Snapshot
  expect(snapshot).toMatchObject({ method: 'sequential', exposures: { total: 2, excludedMultiArm: 1 }, window: { to: phase.endedAt } })
  expect(snapshot.metrics[0]).toMatchObject({ name: 'Frozen signup' })
  expect(snapshot.metrics[0]!.unavailable).toBeUndefined()
  expect(snapshot.metrics[0]!.perArm.find(arm => arm.arm === 'control')!.converters).toBe(1)
  expect(snapshot.metrics[0]!.perArm.find(arm => arm.arm === 'variantA')!.converters).toBe(0)
})

test('ended historical test rounds keep stopped wording after the experiment restarts', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { endedAt: new Date(start + 10_000).toISOString() })
  await events(phase, [{}, {}, {}, {}])
  await runResults(payload().payload)
  const snapshot = (await snapshots())[0]!.snapshot as import('../../src/types/snapshot.js').Snapshot
  expect(snapshot.verdict.finding).toBe('Stopped before enough data was collected.')
})

test('user-unit conversion carrying a visitor cookie is matched by user_id', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('user')
  await events(phase, [{ unitId: 'user-42', unitType: 'user' }, { unitId: 'user-43', unitType: 'user' },
    { type: 'conversion', unitId: 'cookie-visitor', userId: 'user-42', eventName: 'signup', value: 1, ts: new Date(start + 2000).toISOString() }])
  await runResults(payload().payload, { experimentId: phase.experiment })
  const snapshot = (await snapshots())[0]!.snapshot as import('../../src/types/snapshot.js').Snapshot
  expect(snapshot.exposures.total).toBe(2)
  expect(snapshot.metrics[0]!.perArm.find(arm => arm.arm === 'control')!.converters).toBe(1)
})

test.each(['visitor', 'user'] as const)('server-only events remain readable for %s-unit results', async unitType => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed(unitType)
  const direct = `server-direct-${phase.experiment}`, linked = `server-linked-${phase.experiment}`, userId = `server-user-${phase.experiment}`
  await events(phase, [{ unitId: direct, unitType }, { unitId: unitType === 'visitor' ? linked : userId, unitType },
    { type: 'conversion', unitId: direct, userId: unitType === 'user' ? direct : undefined, eventName: 'signup', value: 1, ts: new Date(start + 2000).toISOString() },
    { type: 'conversion', unitId: 'signed-in-cookie', userId, eventName: 'signup', value: 1, ts: new Date(start + 2000).toISOString() }])
  const context = payload()
  context.options.eventSources = [{ name: 'signup', clientWritable: false }]
  if (unitType === 'visitor') await insertIdentity(pooledExecutor(context.payload), { anonymousId: linked, userId })
  expect(await runResults(context.payload, { experimentId: phase.experiment })).toMatchObject({ ran: 1, unavailableMetrics: [] })
  const snapshot = (await snapshots())[0]!.snapshot as import('../../src/types/snapshot.js').Snapshot
  expect(snapshot.metrics[0]!.unavailable).toBeUndefined()
  expect(snapshot.metrics[0]!.perArm.map(arm => arm.converters)).toEqual([1, 1])
})

test('visitor user-keyed sources credit earliest linked visitor and report cross-arm diagnostics', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed()
  phase.metricDefinitions[0]!.source = 'binomial'
  phase.metricDefinitions[0]!.keyedBy = 'user'
  await database.db.update(xp_phases).set({ metricDefinitions: phase.metricDefinitions }).where(eq(xp_phases.experiment, Number(phase.experiment)))
  await events(phase, [{ unitId: 'credit-a' }, { unitId: 'credit-b', ts: new Date(start + 1500).toISOString() }])
  const context = payload(), exec = pooledExecutor(context.payload)
  await insertIdentity(exec, { anonymousId: 'credit-a', userId: 'credit-user' })
  await insertIdentity(exec, { anonymousId: 'credit-b', userId: 'credit-user' })
  context.options.metricSources![0]!.query = vi.fn(async () => [{ unitId: 'credit-user', value: 1, ts: new Date(start + 2000) }])
  await runResults(context.payload)
  const snapshot = (await snapshots())[0]!.snapshot as import('../../src/types/snapshot.js').Snapshot
  expect(snapshot.exposures).toMatchObject({ total: 2, identityConflictShare: 1 })
  expect(snapshot.metrics[0]!.perArm.map(arm => arm.converters)).toEqual([1, 0])
  expect(context.options.metricSources![0]!.query).toHaveBeenCalledWith({ from: new Date(start), to: new Date(now), unitIds: ['credit-user'] })
})

test('throwing source makes only that metric unavailable; broken experiment does not stall the next', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const broken = await seed('visitor', { arms: [] })
  const good = await seed()
  const definitions = [...good.metricDefinitions, { ...good.metricDefinitions[0]!, metricId: 'failing', source: 'count', kind: 'count' as const, role: 'secondary' as const }]
  await database.db.update(xp_phases).set({ metricDefinitions: definitions }).where(eq(xp_phases.experiment, Number(good.experiment)))
  await events(good, [{}, {}, {}, {}])
  const context = payload()
  context.options.metricSources![1]!.query = async () => { throw new Error('Source failed') }
  expect(await runResults(context.payload)).toMatchObject({ ran: 1, skipped: 1, processedIds: [good.experiment] })
  expect(context.payload.logs).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'error', args: [expect.objectContaining({ experimentId: broken.experiment }), expect.any(String)] })]))
  const snapshot = (await snapshots())[0]!.snapshot as import('../../src/types/snapshot.js').Snapshot
  expect(snapshot.metrics[0]!.unavailable).toBeUndefined()
  expect(snapshot.metrics[1]!.unavailable).toBe('Source failed')
})

test('CUPED requests the pre-period per exposed unit, and frozen revenue cap also caps covariates', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('user', { analysis: { method: 'sequential', cuped: 'auto', sequentialTuningParameter: 5000, minExposuresPerArm: 200, plannedDurationDays: 14 },
    metricDefinitions: [{ metricId: 'revenue', name: 'Revenue', kind: 'revenue', role: 'primary', source: 'revenue', keyedBy: 'user', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150,
      capping: { type: 'absolute', value: 10 }, resolvedCap: 10 }] })
  const ids = ['cap-a', 'cap-b', 'cap-c', 'cap-d']
  await events(phase, ids.map(unitId => ({ unitId, unitType: 'user' as const })))
  const context = payload(), source = context.options.metricSources![2]!
  source.query = async () => ids.map((unitId, i) => ({ unitId, value: 20 + i, ts: new Date(start + 2000) }))
  source.covariate = vi.fn(async () => ids.map((unitId, i) => ({ unitId, value: [0, 20, 5, 15][i]! })))
  await runResults(context.payload)
  expect(source.covariate).toHaveBeenCalledWith({ lookbackDays: 14, units: ids.map(unitId => ({ unitId, firstExposureTs: new Date(start + 1000) })) })
  const snapshot = (await snapshots())[0]!.snapshot as import('../../src/types/snapshot.js').Snapshot
  expect(snapshot.metrics[0]!.unavailable).toBeUndefined()
  expect(snapshot.metrics[0]!.perArm.map(arm => arm.covariate?.preSum)).toEqual([5, 20])
  expect(snapshot.exposures.capped.revenue).toBe(4)
})

test('rollout uses first valid exposure across phases, exact coverage ranges and pinned SRM weights', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const arms: ResultsPhase['arms'] = [{ key: 'control', label: 'Original', kind: 'control', weight: 5 },
    { key: 'variantA', label: 'Winner', kind: 'variant', weight: 93 }, { key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 2 }]
  const phase = await seed('visitor', { arms, endedAt: new Date(start + 1000).toISOString(), allocation: 50 })
  const rollout: ResultsPhase = { ...phase, phase: 2, phaseKind: 'rollout', startedAt: new Date(start + 1000).toISOString(), endedAt: null, arms: arms.slice(1) }
  await database.db.insert(xp_phases).values({ ...rollout, experiment: Number(phase.experiment), startedAt: String(rollout.startedAt), endedAt: null, arms: [...rollout.arms] })
  const ranges = rolloutBucketRanges([5, 93, 2], .5)
  const findId = (name: string, range: readonly number[]) => {
    for (let i = 0; ; i++) { const id = `${name}-${i}`, bucket = hash(phase.seed, id, 2)!; if (bucket >= range[0]! && bucket < range[1]!) return id }
  }
  const fresh = findId('fresh', ranges.winner), staleOnly = findId('stale-only', ranges.winner), prior = findId('prior', ranges.winner)
  const holdout = findId('holdout', ranges.holdout), outside = findId('outside', [ranges.winner[1], ranges.holdout[0]])
  await events(phase, [{ unitId: prior, ts: new Date(start + 500).toISOString() }, { unitId: staleOnly, ts: new Date(start + 1500).toISOString() }])
  await events(rollout, [{ unitId: fresh, arm: 'variantA', ts: new Date(start + 2000).toISOString() },
    { unitId: staleOnly, arm: 'variantA', ts: new Date(start + 2000).toISOString() },
    { unitId: prior, arm: 'variantA', ts: new Date(start + 2000).toISOString() },
    { unitId: holdout, arm: 'holdout', ts: new Date(start + 2000).toISOString() },
    { unitId: outside, arm: 'variantA', ts: new Date(start + 2000).toISOString() }])
  expect(await runResults(payload().payload)).toMatchObject({ ran: 1, skipped: 0 })
  const rows = await snapshots()
  const snapshot = rows.find(row => row.phase === 2)!.snapshot as import('../../src/types/snapshot.js').Snapshot
  expect(snapshot.exposures.perArm).toEqual({ variantA: 2, holdout: 1 })
  expect(snapshot).toMatchObject({ k: 1, winnerArm: 'variantA', srm: { expected: { variantA: .98, holdout: .02 } } })
})

test('oldest snapshot first, budget stops before next experiment, zero budget does no work', async () => {
  const first = await seed(), second = await seed()
  const context = payload()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  await runResults(context.payload, { experimentId: first.experiment })
  const rows = await resultsCandidates(pooledExecutor(context.payload), { cutoff: new Date(start - 1).toISOString() })
  expect(rows.map(row => row.phase.experiment)).toEqual([second.experiment, first.experiment])
  // Advance the clock after the first snapshot write, independent of driver timing.
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const originalWrite = snapshotDb.writeSnapshots
  vi.spyOn(snapshotDb, 'writeSnapshots').mockImplementation(async (...args) => {
    await originalWrite(...args)
    clock.mockReturnValue(now + 100)
  })
  expect(await runResults(context.payload, { budgetMs: 100 })).toMatchObject({ ran: 1, skipped: 1, processedIds: [second.experiment], budgetExhausted: true })
  clock.mockReturnValue(now)
  expect(await runResults(context.payload, { budgetMs: 0 })).toMatchObject({ ran: 0, skipped: 0, swept: 0, processedIds: [], budgetExhausted: true })
})

test('ended phases freeze after the late-beacon grace; open phases keep running', async () => {
  const phase = await seed('visitor', { endedAt: new Date(start + 1000).toISOString() })
  const context = payload()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  expect(await runResults(context.payload)).toMatchObject({ ran: 1 })
  expect(await runResults(context.payload)).toMatchObject({ ran: 0, skipped: 0 })
  expect(await snapshots()).toHaveLength(1)
  await database.db.update(xp_phases).set({ endedAt: null }).where(eq(xp_phases.experiment, Number(phase.experiment)))
  expect(await runResults(context.payload)).toMatchObject({ ran: 1 })
  expect(await snapshots()).toHaveLength(2)
})

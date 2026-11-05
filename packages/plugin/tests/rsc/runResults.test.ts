import { safeError } from '../../src/log.js'
import type { Payload } from 'payload'
import * as payloadRuntime from 'payload'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { hash, rolloutBucketRanges } from '@delmaredigital/experiments-stats'
import { pooledExecutor } from '../../src/db/executor.js'
import { resultsCandidates } from '../../src/db/snapshots.js'
import * as snapshotDb from '../../src/db/snapshots.js'
import * as resultsDb from '../../src/db/results.js'
import { insertEvents, type EventRow } from '../../src/db/events.js'
import { insertIdentity } from '../../src/db/identities.js'
import { DEFAULT_SEQUENTIAL_TUNING_PARAMETER } from '../../src/constants.js'
import { runResults } from '../../src/server/runResults.js'
import { handleRecompute } from '../../src/endpoints/recompute.js'
import type { Snapshot } from '../../src/types/snapshot.js'
import * as snapshotAnalysis from '../../src/results/snapshot.js'
import * as aggregation from '../../src/results/aggregate.js'
import type { ResultsPhase } from '../../src/db/snapshots.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { xp_experiments, xp_phases, xp_results_snapshots } from '../_fixtures/generated-schema.js'

vi.mock('payload', async original => ({ ...await original<object>(),
  createLocalReq: async (_options: unknown, payload: Payload) => fakeReq({ payload }),
}))

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
    analysis: { method: 'sequential', cuped: 'off', sequentialTuningParameter: DEFAULT_SEQUENTIAL_TUNING_PARAMETER, plannedDurationDays: 14, minExposuresPerArm: 200 },
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
  expect(snapshot.params.sequentialTuningParameter).toBe(tuning ?? DEFAULT_SEQUENTIAL_TUNING_PARAMETER)
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
  expect(candidate.params.sequentialTuningParameter).toBe(tuning ?? DEFAULT_SEQUENTIAL_TUNING_PARAMETER)
  expect(result).toMatchObject({ ran: 1, skipped: 0, failed: 0, processedIds: [phase.experiment], budgetExhausted: false })
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

test('runResults counts a real analysis failure separately from budget exhaustion', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { metricDefinitions: [] })
  const context = payload()
  expect(await runResults(context.payload, { experimentId: phase.experiment, sweep: false })).toMatchObject({
    ran: 0, skipped: 1, failed: 1, processedIds: [], budgetExhausted: false,
  })
  expect(context.payload.logs).toContainEqual({ level: 'error', args: [
    { err: { name: 'XpAnalysisError', code: 'primary-metric-count', message: 'Phase must have exactly one primary metric', stack: expect.stringContaining('at ') }, experimentId: phase.experiment }, 'Experiment results failed',
  ] })
  const error = context.payload.logs.find(log => log.level === 'error')!.args[0] as { err: Record<string, unknown> }
  expect(error.err.message).toBe('Phase must have exactly one primary metric')
  expect(error.err).not.toBeInstanceOf(Error)
  expect(await snapshots()).toHaveLength(0)
  expect(context.payload.logs.some(log => log.args.includes('Experiment version page lookup failed'))).toBe(false)
})

test('runResults logs a fixed code and message for an invalid stored exposure timestamp', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed()
  const context = payload()
  // Inject a malformed stored row at the reader boundary; PostgreSQL rejects
  // invalid timestamp text before it could reach the aggregation helpers.
  vi.spyOn(resultsDb, 'phaseExposureRows').mockResolvedValueOnce([
    { unitId: 'bad-timestamp', arm: 'control', ts: NaN },
  ])
  expect(await runResults(context.payload, { experimentId: phase.experiment, sweep: false })).toMatchObject({
    ran: 0, skipped: 1, failed: 1, processedIds: [], budgetExhausted: false,
  })
  expect(context.payload.logs).toContainEqual({ level: 'error', args: [
    { err: { name: 'XpAnalysisError', code: 'invalid-timestamp', message: 'Event or exposure timestamp is invalid', stack: expect.stringContaining('at ') }, experimentId: phase.experiment }, 'Experiment results failed',
  ] })
  const error = context.payload.logs.find(log => log.level === 'error')!.args[0] as { err: Record<string, unknown> }
  expect(error.err).not.toBeInstanceOf(Error)
  expect(await snapshots()).toHaveLength(0)
})

test('runResults counts a non-budget scheduling failure', async () => {
  const context = payload(), error = new Error('Scheduling database unavailable')
  vi.spyOn(database.db, 'execute').mockRejectedValueOnce(error)
  expect(await runResults(context.payload, { experimentId: 42, sweep: false })).toMatchObject({
    ran: 0, skipped: 1, failed: 1, budgetExhausted: false,
  })
  expect(context.payload.logs).toContainEqual({ level: 'error', args: [
    { err: safeError(error), experimentId: 42 }, 'Experiment scheduling failed',
  ] })
})

test('recompute returns analysis-failed with HTTP 500 for a real analysis failure', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { metricDefinitions: [] })
  const context = payload()
  Object.assign(context.payload.db, { defaultIDType: 'number' })
  context.payload.documents['xp-experiments'] = [{ id: phase.experiment }]
  const response = await handleRecompute(fakeReq({ payload: context.payload,
    routeParams: { id: String(phase.experiment) }, method: 'POST' }), { options: context.options })
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ errors: [{ code: 'analysis-failed', message: 'Results could not be computed; this has been logged.' }] })
  expect(context.payload.logs).toContainEqual({ level: 'error', args: [
    { err: { name: 'XpAnalysisError', code: 'primary-metric-count', message: 'Phase must have exactly one primary metric', stack: expect.stringContaining('at ') }, experimentId: phase.experiment }, 'Experiment results failed',
  ] })
  expect(await snapshots()).toHaveLength(0)
  expect(context.payload.logs.some(log => log.args.includes('Experiment version page lookup failed'))).toBe(false)
})

test('recompute returns recompute-failed with HTTP 503 when the real run exhausts its budget', async () => {
  const phase = await seed(), context = payload()
  Object.assign(context.payload.db, { defaultIDType: 'number' })
  context.payload.documents['xp-experiments'] = [{ id: phase.experiment }]
  // Scheduling uses real SQL; advance time once it returns to exhaust the
  // endpoint's default 20-second budget before analysis can start.
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const originalCandidates = snapshotDb.resultsCandidates
  vi.spyOn(snapshotDb, 'resultsCandidates').mockImplementation(async (...args) => {
    const candidates = await originalCandidates(...args)
    expect(candidates).toHaveLength(1)
    clock.mockReturnValue(now + 20_000)
    return candidates
  })
  const response = await handleRecompute(fakeReq({ payload: context.payload,
    routeParams: { id: String(phase.experiment) }, method: 'POST' }), { options: context.options })
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ errors: [{ code: 'recompute-failed', message: 'Results could not be recomputed. Try again.' }] })
  expect(await snapshots()).toHaveLength(0)
  expect(context.payload.logs.filter(log => log.level === 'error')).toEqual([])
})

test('frozen config, exposure denominator, multi-arm exclusion and strict endedAt survive live edits', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { endedAt: new Date(start + 86_400_000).toISOString() })
  await events(phase, [{ unitId: 'a' }, { unitId: 'b' }, { unitId: 'multi' }, { unitId: 'multi' },
    { unitId: 'late', ts: String(phase.endedAt) }, { unitId: 'b', arm: 'control', ts: String(phase.endedAt) },
    { type: 'conversion', unitId: 'a', eventName: 'signup', value: 1, ts: new Date(start + 2 * 3_600_000).toISOString() },
    { type: 'conversion', unitId: 'b', eventName: 'signup', value: 1, ts: String(phase.endedAt) }])
  const context = payload()
  expect(await runResults(context.payload)).toMatchObject({ ran: 1, skipped: 0, failed: 0, processedIds: [phase.experiment], budgetExhausted: false })
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
  if (unitType === 'visitor') await insertIdentity(pooledExecutor(context.payload), { verified: false, anonymousId: linked, userId })
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
  await insertIdentity(exec, { verified: false, anonymousId: 'credit-a', userId: 'credit-user' })
  await insertIdentity(exec, { verified: false, anonymousId: 'credit-b', userId: 'credit-user' })
  context.options.metricSources![0]!.query = vi.fn(async () => [{ unitId: 'credit-user', value: 1, ts: new Date(start + 2000) }])
  await runResults(context.payload)
  const snapshot = (await snapshots())[0]!.snapshot as import('../../src/types/snapshot.js').Snapshot
  expect(snapshot.exposures).toMatchObject({ total: 2, identityConflictShare: 1 })
  expect(snapshot.metrics[0]!.perArm.map(arm => arm.converters)).toEqual([1, 0])
  expect(context.options.metricSources![0]!.query).toHaveBeenCalledWith({ from: new Date(start), to: new Date(now), unitIds: ['credit-user'] })
})

test.each([
  { ownExposed: true, eligible: false, expected: [0, 1], conflict: 0 },
  { ownExposed: true, eligible: true, expected: [0, 1], conflict: 1 },
  { ownExposed: false, eligible: true, expected: [1, 0], conflict: 0 },
  { ownExposed: false, eligible: false, expected: [0, 0], conflict: 0 },
])('visitor-keyed events: ownExposed=$ownExposed eligible=$eligible', async ({ ownExposed, eligible, expected, conflict }) => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { metricDefinitions: [
    { metricId: 'count', name: 'Count', kind: 'count', role: 'primary', source: 'count', keyedBy: 'visitor', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150 },
    { metricId: 'signup', name: 'Signup', kind: 'binomial', role: 'secondary', source: 'events:signup', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150 },
  ] })
  const earlier = `own-earlier-${phase.experiment}`, own = `own-browser-${phase.experiment}`, userId = `own-user-${phase.experiment}`
  await events(phase, [
    { unitId: earlier },
    { unitId: ownExposed ? own : `other-${phase.experiment}`, ts: new Date(start + 1500).toISOString() },
    { type: 'conversion', unitId: own, userId, eventName: 'signup', value: 1, ts: new Date(start + 3000).toISOString() },
  ])
  const context = payload(), exec = pooledExecutor(context.payload)
  await insertIdentity(exec, { anonymousId: earlier, userId, verified: false })
  if (ownExposed) await insertIdentity(exec, { anonymousId: own, userId, verified: false })
  if (!eligible) {
    await insertIdentity(exec, { anonymousId: `proof-${phase.experiment}`, userId, verified: true })
    await exec.query('UPDATE xp_identities SET verified_at = $1 WHERE user_id = $2 AND verified_at IS NOT NULL', [new Date(start + 2000).toISOString(), userId])
  }
  const source = context.options.metricSources!.find(source => source.id === 'count')!
  source.keyedBy = 'visitor'
  source.query = async () => [{ unitId: own, userId, value: 1, ts: new Date(start + 3000) }]
  const aggregated = vi.spyOn(aggregation, 'perUnitValues')
  expect(await runResults(context.payload, { experimentId: phase.experiment, sweep: false })).toMatchObject({ ran: 1, failed: 0, unavailableMetrics: [] })
  const snapshot = (await snapshots())[0]!.snapshot as Snapshot
  expect(snapshot.metrics[0]!.perArm.map(arm => arm.sum)).toEqual(expected)
  expect(snapshot.metrics[1]!.perArm.map(arm => arm.converters)).toEqual(expected)
  expect(snapshot.exposures.identityConflictShare).toBe(conflict)
  // A stored conversion can match both lookups. Binomial aggregation would hide
  // double credit, so check the actual event list handed to the aggregator too.
  for (const [, credited] of aggregated.mock.calls) expect(credited).toHaveLength(expected.reduce((a, b) => a + b, 0))
})

test('identity conflicts include direct visitor credits across arms even when every link is ineligible', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed()
  const earlier = `span-earlier-${phase.experiment}`, own = `span-own-${phase.experiment}`, userId = `span-user-${phase.experiment}`
  await events(phase, [
    { unitId: earlier }, { unitId: own, ts: new Date(start + 1500).toISOString() },
    ...[earlier, own].map(unitId => ({ type: 'conversion' as const, unitId, userId, eventName: 'signup', value: 1, ts: new Date(start + 3000).toISOString() })),
  ])
  const context = payload(), exec = pooledExecutor(context.payload)
  for (const anonymousId of [earlier, own]) await insertIdentity(exec, { anonymousId, userId, verified: false })
  await insertIdentity(exec, { anonymousId: `span-proof-${phase.experiment}`, userId, verified: true })
  await exec.query('UPDATE xp_identities SET verified_at = $1 WHERE user_id = $2 AND verified_at IS NOT NULL', [new Date(start + 2000).toISOString(), userId])
  expect(await runResults(context.payload, { experimentId: phase.experiment, sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const snapshot = (await snapshots())[0]!.snapshot as Snapshot
  expect(snapshot.metrics[0]!.perArm.map(arm => arm.converters)).toEqual([1, 1])
  expect(snapshot.exposures.identityConflictShare).toBe(1)
})

test.each([true, false])('a user-keyed source still requires eligible links when the user ID matches an exposed visitor ID: eligible=%s', async eligible => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { metricDefinitions: [
    { metricId: 'count', name: 'Count', kind: 'count', role: 'primary', source: 'count', keyedBy: 'user', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150 },
  ] })
  const earlier = `user-key-earlier-${phase.experiment}`, userId = `user-key-${phase.experiment}`
  await events(phase, [{ unitId: earlier }, { unitId: userId, ts: new Date(start + 1500).toISOString() }])
  const context = payload(), exec = pooledExecutor(context.payload)
  await insertIdentity(exec, { anonymousId: earlier, userId, verified: false })
  if (!eligible) {
    await insertIdentity(exec, { anonymousId: `user-key-proof-${phase.experiment}`, userId, verified: true })
    await exec.query('UPDATE xp_identities SET verified_at = $1 WHERE user_id = $2 AND verified_at IS NOT NULL', [new Date(start + 2000).toISOString(), userId])
  }
  context.options.metricSources!.find(source => source.id === 'count')!.query = async () => [{ unitId: userId, value: 1, ts: new Date(start + 3000) }]
  expect(await runResults(context.payload, { experimentId: phase.experiment, sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const snapshot = (await snapshots())[0]!.snapshot as Snapshot
  expect(snapshot.metrics[0]!.perArm.map(arm => arm.sum)).toEqual([eligible ? 1 : 0, 0])
})

test('throwing source makes only that metric unavailable; broken experiment does not stall the next', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const broken = await seed('visitor', { arms: [] })
  const good = await seed()
  const definitions = [...good.metricDefinitions, { ...good.metricDefinitions[0]!, metricId: 'failing', source: 'count', kind: 'count' as const, role: 'secondary' as const }]
  await database.db.update(xp_phases).set({ metricDefinitions: definitions }).where(eq(xp_phases.experiment, Number(good.experiment)))
  await events(good, [{}, {}, {}, {}])
  const context = payload()
  context.options.metricSources![1]!.query = async () => { throw new Error('secret-value source row') }
  const summary = await runResults(context.payload)
  expect(summary).toMatchObject({ ran: 1, skipped: 1, failed: 1, processedIds: [good.experiment] })
  expect(context.payload.logs).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'error', args: [expect.objectContaining({ experimentId: broken.experiment }), expect.any(String)] })]))
  const snapshot = (await snapshots())[0]!.snapshot as import('../../src/types/snapshot.js').Snapshot
  expect(snapshot.metrics[0]!.unavailable).toBeUndefined()
  expect(snapshot.metrics[1]!.unavailable).toBe('source-failed')
  expect(JSON.stringify(snapshot)).not.toContain('secret-value')
  expect(JSON.stringify(summary)).not.toContain('secret-value')
  expect(summary.unavailableMetrics).toEqual([{ experimentId: good.experiment, phase: good.phase, metricId: 'failing', reason: 'source-failed' }])
  expect(context.payload.logs).toContainEqual({ level: 'error', args: [expect.objectContaining({ experimentId: good.experiment, metricId: 'failing' }), 'Experiment metric source failed'] })
  expect(JSON.stringify(context.payload.logs)).not.toContain('secret-value')
})

test('CUPED requests the pre-period per exposed unit, and frozen revenue cap also caps covariates', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('user', { analysis: { method: 'sequential', cuped: 'auto', sequentialTuningParameter: DEFAULT_SEQUENTIAL_TUNING_PARAMETER, minExposuresPerArm: 200, plannedDurationDays: 14 },
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
    { key: 'variantA', label: 'Winner', kind: 'variant', weight: 90 },
    { key: 'variantB', label: 'Loser', kind: 'variant', weight: 3, pageTarget: '/loser' }, { key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 2 }]
  const phase = await seed('visitor', { arms, endedAt: new Date(start + 1000).toISOString(), allocation: 50 })
  const rollout: ResultsPhase = { ...phase, phase: 2, phaseKind: 'rollout', startedAt: new Date(start + 1000).toISOString(), endedAt: null, arms: arms.filter(arm => arm.key === 'variantA' || arm.kind === 'holdout') }
  await database.db.insert(xp_phases).values({ ...rollout, experiment: Number(phase.experiment), startedAt: String(rollout.startedAt), endedAt: null, arms: [...rollout.arms] })
  const ranges = rolloutBucketRanges([5, 90, 3, 2], .5)
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
  await database.db.update(xp_experiments).set({ kind: 'page', status: 'decided', phase: 2 }).where(eq(xp_experiments.id, Number(phase.experiment)))
  await database.db.update(xp_phases).set({ arms: arms.map(arm => ({ ...arm, ...(arm.kind === 'control' ? { pageTarget: '/original' } : arm.key === 'variantA' ? { pageTarget: '/winner' } : {}) })) }).where(eq(xp_phases.phase, 1))
  await database.db.update(xp_phases).set({ arms: rollout.arms.map(arm => ({ ...arm, ...(arm.kind !== 'holdout' ? { pageTarget: '/winner' } : {}) })) }).where(eq(xp_phases.phase, 2))
  const context = payload()
  const lookup = vi.fn(async (_path: string) => ({ id: 1, published: true }))
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath: lookup }] }
  expect(await runResults(context.payload)).toMatchObject({ ran: 1, skipped: 0 })
  expect(lookup.mock.calls).toHaveLength(2)
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
  expect(await runResults(context.payload, { budgetMs: 100 })).toMatchObject({ ran: 1, skipped: 1, failed: 0, processedIds: [second.experiment], budgetExhausted: true })
  clock.mockReturnValue(now)
  expect(await runResults(context.payload, { budgetMs: 0 })).toMatchObject({ ran: 0, skipped: 0, failed: 0, swept: 0, processedIds: [], budgetExhausted: true })
})

test.each([false, true])('analysis (ended=%s) precedes older decided page health across budgeted passes', async ended => {
  const decided = await seed('visitor', { endedAt: new Date(start + 1000).toISOString(), arms: [
    { key: 'control', label: 'Original', kind: 'control', weight: 50, pageTarget: '/original' },
    { key: 'variantA', label: 'Winner', kind: 'variant', weight: 50, pageTarget: '/winner' },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', status: 'decided', phase: 1, decision_winnerArm: 'variantA' })
    .where(eq(xp_experiments.id, Number(decided.experiment)))
  const context = payload()
  const lookup = vi.fn(async (_path: string) => ({ id: 1, published: true }))
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath: lookup }] }
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 10_000)
  await runResults(context.payload, { experimentId: decided.experiment, sweep: false })
  const frozen = (await snapshots())[0]!
  const analysis = await seed('visitor', ended ? { endedAt: new Date(now - 1000).toISOString() } : {})
  clock.mockReturnValue(now - 5000)
  await runResults(context.payload, { experimentId: analysis.experiment, sweep: false })
  const candidates = await resultsCandidates(pooledExecutor(context.payload), { cutoff: new Date(start - 1).toISOString() })
  expect(candidates.map(candidate => candidate.phase.experiment)).toEqual([analysis.experiment, decided.experiment])
  expect(candidates[0]!.frozenSnapshot).toBeNull()
  expect(candidates[1]!.frozenSnapshot).toEqual(frozen.snapshot)
  expect(candidates[1]!.winnerArm).toBe('variantA')
  const originalWrite = snapshotDb.writeSnapshots
  vi.spyOn(snapshotDb, 'writeSnapshots').mockImplementation(async (...args) => {
    await originalWrite(...args)
    clock.mockReturnValue(now + 100)
  })
  lookup.mockClear()
  for (let pass = 0; pass < 2; pass++) {
    clock.mockReturnValue(now)
    expect(await runResults(context.payload, { budgetMs: 100, sweep: false })).toMatchObject({
      ran: 1, skipped: 1, failed: 0, processedIds: [analysis.experiment], budgetExhausted: true,
    })
  }
  expect(lookup).not.toHaveBeenCalled()
  expect((await snapshots()).filter(row => row.experiment === decided.experiment)).toEqual([frozen])
})

test('one-health-check budgets visit both frozen page tests within 40 unseeded passes', async () => {
  const context = payload()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const lookup = vi.fn(async (_path: string) => ({ id: 1, published: true }))
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath: lookup }] }
  for (const name of ['first', 'second']) {
    const phase = await seed('visitor', { endedAt: new Date(start + 1000).toISOString(), arms: [
      { key: 'control', label: 'Original', kind: 'control', weight: 50, pageTarget: `/${name}-original` },
      { key: 'variantA', label: 'Winner', kind: 'variant', weight: 50, pageTarget: `/${name}-winner` },
    ] })
    await database.db.update(xp_experiments).set({ kind: 'page', status: 'decided', phase: 1, decision_winnerArm: 'variantA' })
      .where(eq(xp_experiments.id, Number(phase.experiment)))
    expect(await runResults(context.payload, { experimentId: phase.experiment, sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  }
  const frozen = await snapshots()
  let checks = 0
  vi.spyOn(payloadRuntime, 'createLocalReq').mockImplementation(async () => {
    // Expire the budget at the second experiment's health check. The first
    // completes unchanged and writes nothing, so its ordering key stays fixed.
    if (++checks === 2) clock.mockReturnValue(now + 100)
    return fakeReq({ payload: context.payload })
  })
  lookup.mockClear()
  for (let pass = 0; pass < 40; pass++) {
    checks = 0
    clock.mockReturnValue(now)
    expect(await runResults(context.payload, { budgetMs: 100, sweep: false })).toMatchObject({ ran: 1, failed: 0, budgetExhausted: true })
  }
  const paths = lookup.mock.calls.map(([path]) => path)
  // Independent uniform random ordering: P(one of two never first) = 2^-39,
  // about 1.82e-12. No RNG seed or ordering mock is used.
  expect(paths).toContain('/first-original')
  expect(paths).toContain('/second-original')
  expect(await snapshots()).toEqual(frozen)
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


test.each(['source-unavailable', 'unit-type-unavailable', 'non-finite-values', 'non-finite-covariates'] as const)('fixed plugin metric failures carry %s', async reason => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const source = reason === 'source-unavailable' ? 'missing' : 'binomial'
  const phase = await seed('user', {
    analysis: { method: 'sequential', cuped: 'auto', minExposuresPerArm: 200, plannedDurationDays: 14 },
    metricDefinitions: [{ metricId: 'primary', name: 'Goal', kind: 'binomial', role: 'primary', source, direction: 'increase', attributionWindowHours: 168, minSampleSize: 150 }],
  })
  const context = payload(), metric = context.options.metricSources![0]!
  if (reason === 'unit-type-unavailable') metric.keyedBy = 'visitor'
  if (reason === 'non-finite-values') metric.query = async () => [{ unitId: 'a', value: NaN, ts: new Date(start) }]
  if (reason === 'non-finite-covariates') metric.covariate = async () => [{ unitId: 'a', value: Infinity }]
  const summary = await runResults(context.payload, { sweep: false })
  expect(summary).toMatchObject({ ran: 1, unavailableMetrics: [{ experimentId: phase.experiment, metricId: 'primary', reason }] })
  expect(((await snapshots())[0]!.snapshot as Snapshot).metrics[0]!.unavailable).toBe(reason)
})


test('page health re-check writes missing and unchecked paths for running tests as anonymous', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/original' },
    { key: 'variantA', kind: 'variant', label: 'Version', weight: 47, pageTarget: '/unpublished' },
    { key: 'variantB', kind: 'variant', label: 'Version B', weight: 1, pageTarget: '/throwing' },
    { key: 'variantC', kind: 'variant', label: 'Version C', weight: 1, pageTarget: '/missing' },
    { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 1 },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', status: 'running', phase: 1, pageCollection: 'pages' }).where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  const lookup = vi.fn(async (path: string, req: import('payload').PayloadRequest) => {
    expect(req.user).toBeNull()
    expect(req.payload).toBe(context.payload)
    if (path === '/missing') return null
    if (path === '/throwing') throw new Error('secret-value lookup failed')
    return path === '/original' ? { id: 1, published: true } : { id: 2, published: false }
  })
  const otherLookup = vi.fn(async () => ({ id: 999, published: true }))
  context.options.pages = { collections: [{ slug: 'other', pathOf: () => null, findByPath: otherLookup }, { slug: 'pages', pathOf: () => null, findByPath: lookup }] }
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(otherLookup).not.toHaveBeenCalled()
  expect(await snapshots()).toHaveLength(2)
  const snapshot = (await snapshots())[0]!.snapshot as Snapshot
  expect(snapshot.health).toEqual([
    { code: 'version-page-unavailable', path: '/unpublished' }, { code: 'version-page-unchecked', path: '/throwing' },
    { code: 'version-page-unavailable', path: '/missing' },
  ])
  expect(lookup.mock.calls.map(call => call[0])).toEqual(['/original', '/unpublished', '/throwing', '/missing', '/original', '/unpublished', '/throwing', '/missing'])
  expect(JSON.stringify(context.payload.logs)).not.toContain('secret-value')
  expect(context.payload.logs.some(log => log.level === 'error')).toBe(true)
})

test.each([
  ['variantA', '/loser', []],
  ['variantA', '/version', ['/version']],
  ['variantA', '/original', ['/original']],
  ['control', '/version', []],
] as const)('decided non-rollout winner %s checks served pages when %s is unpublished', async (winner, unavailable, paths) => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { endedAt: new Date(start + 1000).toISOString(), arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/original' },
    { key: 'variantA', kind: 'variant', label: 'Winner', weight: 30, pageTarget: '/version' },
    { key: 'variantB', kind: 'variant', label: 'Loser', weight: 20, pageTarget: '/loser' },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', status: 'decided', phase: 1, decision_winnerArm: winner })
    .where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  const lookup = vi.fn(async (path: string) => ({ id: 1, published: path !== '/loser' && path !== unavailable }))
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath: lookup }] }
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(((await snapshots())[0]!.snapshot as Snapshot).health).toEqual(paths.map(path => ({ code: 'version-page-unavailable', path })))
  expect(lookup.mock.calls.map(([path]) => path)).toEqual(winner === 'control' ? ['/original'] : ['/original', '/version'])
})

test('recompute returns 200 with the existing snapshot when decided page health is unchanged', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { endedAt: new Date(start + 1000).toISOString(), arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/original' },
    { key: 'variantA', kind: 'variant', label: 'Winner', weight: 50, pageTarget: '/winner' },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', status: 'decided', phase: 1, decision_winnerArm: 'variantA' })
    .where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath: async () => ({ id: 1, published: true }) }] }
  expect(await runResults(context.payload, { experimentId: phase.experiment, sweep: false })).toMatchObject({ ran: 1 })
  const existing = (await snapshots())[0]!
  Object.assign(context.payload.db, { defaultIDType: 'number' })
  context.payload.documents['xp-experiments'] = [{ id: phase.experiment }]
  const find = context.payload.find.bind(context.payload)
  vi.spyOn(context.payload, 'find').mockImplementation(async args => {
    if (args.collection === 'xp-results-snapshots') context.payload.documents[args.collection] = await snapshots()
    return find(args)
  })
  const response = await handleRecompute(fakeReq({ payload: context.payload, routeParams: { id: String(phase.experiment) }, method: 'POST' }), { options: context.options })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ snapshotId: existing.id })
  expect(await snapshots()).toEqual([existing])
})

test('page lookups respect the results deadline and cannot hang the pass', async () => {
  const phase = await seed('visitor', { arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/original' },
    { key: 'variantA', kind: 'variant', label: 'Version', weight: 50, pageTarget: '/version' },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', phase: 1 }).where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  const findByPath = vi.fn(() => new Promise<never>(() => {}))
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath }] }
  // The budget is the test's wait; it must still outlast the analysis so the lookup is reached.
  const summary = await runResults(context.payload, { budgetMs: 300, sweep: false })
  expect(findByPath).toHaveBeenCalled()
  expect(summary).toMatchObject({ ran: 0, budgetExhausted: true })
  expect(await snapshots()).toHaveLength(0)
  expect(context.payload.logs.some(log => log.args.includes('Experiment version page lookup failed'))).toBe(false)
})

test.each([true, false])('a found page (published=%s) wins over failed lookups in other registered collections', async published => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/original' },
    { key: 'variantA', kind: 'variant', label: 'Version', weight: 50, pageTarget: '/version' },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', phase: 1 }).where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  context.options.pages = { collections: [
    { slug: 'broken', pathOf: () => null, findByPath: async () => { throw new Error('lookup') } },
    { slug: 'pages', pathOf: () => null, findByPath: async () => ({ id: 1, published }) },
  ] }
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(((await snapshots())[0]!.snapshot as Snapshot).health).toEqual(published ? [] : [
    { code: 'version-page-unavailable', path: '/original' }, { code: 'version-page-unavailable', path: '/version' },
  ])
})

test('frozen page health compares canonically, writes changes once, and keeps inference frozen', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { endedAt: new Date(start + 1000).toISOString(), arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/original' },
    { key: 'variantA', kind: 'variant', label: 'Version', weight: 50, pageTarget: '/version' },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', status: 'decided', phase: 1, decision_winnerArm: 'variantA' }).where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  const lookup = vi.fn(async () => null as { id: number; published: boolean } | null)
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath: lookup }] }
  await runResults(context.payload, { sweep: false })
  const row = (await snapshots())[0]!, frozen = row.snapshot as Snapshot
  // JSON key order and list order must not make health appear changed.
  await database.db.update(xp_results_snapshots).set({ snapshot: { ...frozen, health: [...frozen.health!].reverse().map(row => ({ ...row })) } })
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, skipped: 0 })
  expect(await snapshots()).toHaveLength(1)
  lookup.mockResolvedValue({ id: 1, published: true })
  vi.spyOn(Date, 'now').mockReturnValue(now + 1000)
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1 })
  expect(await snapshots()).toHaveLength(2)
  const changed = (await snapshots()).find(item => item.id !== row.id)!.snapshot as Snapshot
  expect(changed).toEqual({ ...frozen, health: [], computedAt: new Date(now + 1000).toISOString() })
  // undefined and [] are equivalent too.
  await database.db.update(xp_results_snapshots).set({ snapshot: { ...changed, health: undefined } })
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, skipped: 0 })
})

test('page phases beyond retention never reanalyse swept events, but existing snapshots still refresh health', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { endedAt: new Date(start + 1000).toISOString(), arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/original' },
    { key: 'variantA', kind: 'variant', label: 'Version', weight: 50, pageTarget: '/version' },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', status: 'decided', phase: 1, decision_winnerArm: 'variantA' }).where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  context.options.events = { ...context.options.events, retentionDays: 1 }
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath: async () => null }] }
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 0 })
  expect(await snapshots()).toHaveLength(0)
  context.options.events.retentionDays = 3
  // The only existing snapshot predates the final grace snapshot. Once the
  // events expire it is still safe to copy health, never to redo inference.
  vi.spyOn(Date, 'now').mockReturnValue(start + 5000)
  await runResults(context.payload, { sweep: false })
  await events(phase, [{ ts: new Date(start + 500).toISOString() }])
  vi.spyOn(Date, 'now').mockReturnValue(now)
  context.options.events.retentionDays = 1
  context.options.pages.collections[0]!.findByPath = async () => ({ id: 1, published: true })
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1 })
  const rows = await snapshots()
  expect(rows.map(row => (row.snapshot as Snapshot).health)).toContainEqual([])
  expect(rows.every(row => (row.snapshot as Snapshot).exposures.total === 0)).toBe(true)
})

test.each(['revenue', 'count', 'binomial'] as const)('CUPED %s credits one aggregate per user with eligibility at firstExposureTs', async kind => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { analysis: { method: 'sequential', cuped: 'auto', sequentialTuningParameter: 5000, minExposuresPerArm: 200, plannedDurationDays: 14 },
    metricDefinitions: [{ metricId: 'pre', name: 'Pre', kind, role: 'primary', source: kind, keyedBy: 'user', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150 }] })
  const a = `cov-a-${phase.experiment}`, b = `cov-b-${phase.experiment}`, c = `cov-c-${phase.experiment}`
  const owner = `cov-owner-${phase.experiment}`, laterOwner = `cov-later-owner-${phase.experiment}`
  await events(phase, [
    { unitId: b, ts: new Date(start + 3000).toISOString() },
    { unitId: a },
    { unitId: c, ts: new Date(start + 3000).toISOString() },
  ])
  const context = payload(), exec = pooledExecutor(context.payload), source = context.options.metricSources!.find(source => source.id === kind)!
  for (const anonymousId of [b, a]) await insertIdentity(exec, { anonymousId, userId: owner, verified: false })
  await insertIdentity(exec, { anonymousId: c, userId: laterOwner, verified: false })
  for (const userId of [owner, laterOwner]) {
    await insertIdentity(exec, { anonymousId: `unexposed-${userId}`, userId, verified: true })
    await exec.query('UPDATE xp_identities SET verified_at = $1 WHERE user_id = $2 AND verified_at IS NOT NULL', [new Date(start + 2000).toISOString(), userId])
  }
  source.query = async () => []
  const value = kind === 'binomial' ? 1 : 10
  source.covariate = vi.fn(async () => [{ unitId: owner, value }])
  expect(await runResults(context.payload, { experimentId: phase.experiment })).toMatchObject({ ran: 1, unavailableMetrics: [] })
  // A was exposed before proof; B and C after proof. Only A can receive the aggregate, even though now is after proof.
  expect(source.covariate).toHaveBeenCalledWith({ units: [{ unitId: owner, firstExposureTs: new Date(start + 1000) }], lookbackDays: 14 })
  const snapshot = (await snapshots())[0]!.snapshot as Snapshot
  expect(snapshot.metrics[0]!.perArm.map(arm => arm.covariate?.preSum)).toEqual([0, value])
})

test('CUPED credits a user aggregate once to the earliest eligible visitor with a stable ID tie-break', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { analysis: { method: 'sequential', cuped: 'auto', sequentialTuningParameter: 5000, minExposuresPerArm: 200, plannedDurationDays: 14 },
    metricDefinitions: [{ metricId: 'pre', name: 'Pre', kind: 'revenue', role: 'primary', source: 'revenue', keyedBy: 'user', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150 }] })
  const a = `cov-first-a-${phase.experiment}`, b = `cov-first-b-${phase.experiment}`, c = `cov-first-c-${phase.experiment}`, owner = `cov-first-owner-${phase.experiment}`
  await events(phase, [{ unitId: b }, { unitId: a }, { unitId: c, ts: new Date(start + 2000).toISOString() }])
  const context = payload(), exec = pooledExecutor(context.payload), source = context.options.metricSources![2]!
  for (const anonymousId of [c, b, a]) await insertIdentity(exec, { anonymousId, userId: owner, verified: false })
  source.query = async () => []
  source.covariate = vi.fn(async () => [{ unitId: owner, value: 10 }])
  expect(await runResults(context.payload, { experimentId: phase.experiment })).toMatchObject({ ran: 1, unavailableMetrics: [] })
  expect(source.covariate).toHaveBeenCalledWith({ units: [{ unitId: owner, firstExposureTs: new Date(start + 1000) }], lookbackDays: 14 })
  const snapshot = (await snapshots())[0]!.snapshot as Snapshot
  expect(snapshot.metrics[0]!.perArm.map(arm => arm.covariate?.preSum)).toEqual([0, 10])
})

test('click sources aggregate click:key conversions with user_id and no registered event source', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('user', { metricDefinitions: [{ metricId: 'click', attributionWindowHours: 168, minSampleSize: 150, name: 'Join clicks', kind: 'binomial', role: 'primary', source: 'click:join', direction: 'increase' }] })
  const context = payload()
  await events(phase, [{ unitId: 'click-user', unitType: 'user', arm: 'control' }, { unitId: 'other-user', unitType: 'user', arm: 'variantA' },
    { type: 'conversion', experimentId: undefined, phase: undefined, unitId: 'cookie', userId: 'click-user', eventName: 'click:join', value: 1 },
    { type: 'conversion', experimentId: undefined, phase: undefined, unitId: 'cookie', userId: 'click-user', eventName: 'join', value: 1 }])
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0, unavailableMetrics: [] })
  const snapshot = (await snapshots())[0]!.snapshot as Snapshot
  expect(snapshot.metrics[0]!.perArm.map(a => a.converters)).toEqual([1, 0])
})
test('running block goal health recomputes published placements and null rounds carry an info line', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { metricDefinitions: [{ metricId: 'click', attributionWindowHours: 168, minSampleSize: 150, name: 'Join clicks', kind: 'binomial', role: 'primary', source: 'click:join', direction: 'increase' }] })
  await database.db.update(xp_experiments).set({ kind: 'block', phase: 1 }).where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  context.options.blocks = { collections: [{ slug: 'pages', field: 'layout' }] }
  Object.assign(context.payload.config, { collections: [{ slug: 'pages', fields: [] }] })
  const content = { id: 7, layout: [{ blockType: 'xpExperiment', experiment: `frozen-${serial}`, slots: [{ slot: 'control', blocks: [{ blockType: 'cta', xpGoal: 'join' }] }, { slot: 'variantA', blocks: [] }] }] }
  Object.assign(context.payload.db, { findOne: vi.fn(async () => content) })
  await runResults(context.payload, { sweep: false })
  expect(((await snapshots())[0]!.snapshot as Snapshot).goalFairnessNotice).toBe("Goal fairness isn't checked for tests started before this update.")
  await database.db.delete(xp_results_snapshots)
  await database.db.update(xp_phases).set({ placementDocs: [{ collection: 'pages', id: 7 }] }).where(eq(xp_phases.experiment, Number(phase.experiment)))
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(((await snapshots())[0]!.snapshot as Snapshot).health).toEqual([{ code: 'goal-in-some-versions', metricId: 'click', name: 'Join clicks' }])
  content.layout[0]!.slots[1]!.blocks.push({ blockType: 'cta', xpGoal: 'join' })
  await database.db.delete(xp_results_snapshots)
  await runResults(context.payload, { sweep: false })
  expect(((await snapshots())[0]!.snapshot as Snapshot).health).toEqual([])
})

test('mid-test click goal excludes pre-added clicks from outcomes for every arm', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const addedAt = new Date(start + 3_600_000).toISOString()
  const phase = await seed('visitor', { metricDefinitions: [{ metricId: 'click', attributionWindowHours: 168, minSampleSize: 150, name: 'Join', kind: 'binomial', role: 'primary', source: 'click:join', direction: 'increase', addedAt }] })
  const context = payload()
  await events(phase, [{ unitId: 'early', arm: 'control' }, { unitId: 'late', arm: 'variantA' },
    { type: 'conversion', experimentId: undefined, phase: undefined, unitId: 'early', eventName: 'click:join', value: 1, ts: new Date(start + 2000).toISOString() },
    { type: 'conversion', experimentId: undefined, phase: undefined, unitId: 'late', eventName: 'click:join', value: 1, ts: addedAt }])
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(((await snapshots())[0]!.snapshot as Snapshot).metrics[0]!.perArm.map(a => a.converters)).toEqual([0, 1])
})

const clickMetric = { metricId: 'click', attributionWindowHours: 168, minSampleSize: 150, name: 'Join clicks', kind: 'binomial' as const, role: 'primary' as const, source: 'click:join', direction: 'increase' as const }
test.each([
  { frozen: false, partial: false }, { frozen: false, partial: true },
  { frozen: true, partial: false }, { frozen: true, partial: true },
])('unreadable goal content retains amber health (frozen: $frozen, partial: $partial)', async ({ frozen, partial }) => {
  let clock = now
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  const phase = await seed('visitor', { metricDefinitions: [clickMetric], ...(frozen ? { endedAt: new Date(start + 1000).toISOString() } : {}) })
  await database.db.update(xp_experiments).set({ kind: 'block', phase: 1, status: frozen ? 'decided' : 'running', decision_winnerArm: frozen ? 'variantA' : null }).where(eq(xp_experiments.id, Number(phase.experiment)))
  await database.db.update(xp_phases).set({ placementDocs: [{ collection: 'pages', id: 7 }, { collection: 'pages', id: 8 }] }).where(eq(xp_phases.experiment, Number(phase.experiment)))
  const context = payload()
  context.options.blocks = { collections: [{ slug: 'pages', field: 'layout' }] }
  Object.assign(context.payload.config, { collections: [{ slug: 'pages', fields: [] }] })
  const content = { id: 7, layout: [{ blockType: 'xpExperiment', experiment: `frozen-${serial}`, slots: [{ slot: 'control', blocks: [{ blockType: 'cta', xpGoal: 'join' }] }, { slot: 'variantA', blocks: [] }] }] }
  const read = vi.fn(async (_args: { where?: { id?: { equals?: unknown } } }) => content)
  Object.assign(context.payload.db, { findOne: read })
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const before = await snapshots()
  const amber = [{ code: 'goal-in-some-versions', metricId: 'click', name: 'Join clicks' }]
  expect((before[0]!.snapshot as Snapshot).health).toEqual(amber)
  read.mockImplementation(async args => {
    if (!partial || args.where?.id?.equals === 8) throw new Error('content unreadable')
    return content
  })
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const after = await snapshots()
  expect(after).toHaveLength(frozen ? 1 : 2)
  expect((after[0]!.snapshot as Snapshot).health).toEqual(amber)
  const expected = [...amber, ...[...(partial ? [] : [7]), 8].map(id => ({ code: 'placement-unchecked', detail: { collection: 'pages', id } }))]
  if (frozen) expect(after).toEqual(before)
  else expect((after[1]!.snapshot as Snapshot).health).toEqual(expected)
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const repeated = await snapshots()
  expect(repeated).toHaveLength(frozen ? 1 : 3)
  expect((repeated.at(-1)!.snapshot as Snapshot).health).toEqual(frozen ? amber : expected)
  read.mockImplementation(async () => content)
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const recovered = await snapshots()
  expect(recovered).toHaveLength(frozen ? 1 : 4)
  expect((recovered.at(-1)!.snapshot as Snapshot).health).toEqual(amber)
  if (frozen) expect(recovered).toEqual(before)
}, 5_000) // Measured 20 ms locally; cap exceeds 3×.

test.each(['deleted', 'unpublished', 'throwing', 'readable'] as const)('a block goal fix clears stale amber health only after a complete read (%s placement)', async state => {
  let clock = now
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  const phase = await seed('visitor', { metricDefinitions: [clickMetric] })
  await database.db.update(xp_experiments).set({ kind: 'block', phase: 1 }).where(eq(xp_experiments.id, Number(phase.experiment)))
  await database.db.update(xp_phases).set({ placementDocs: [{ collection: 'pages', id: 7 }, { collection: 'pages', id: 8 }] }).where(eq(xp_phases.experiment, Number(phase.experiment)))
  const context = payload()
  context.options.blocks = { collections: [{ slug: 'pages', field: 'layout' }] }
  Object.assign(context.payload.config, { collections: [{ slug: 'pages', versions: { drafts: true } }] })
  const content = { id: 7, _status: 'published', layout: [{ blockType: 'xpExperiment', experiment: `frozen-${serial}`, slots: [
    { slot: 'control', blocks: [{ blockType: 'cta', xpGoal: 'join' }] }, { slot: 'variantA', blocks: [] as { blockType: string; xpGoal: string }[] },
  ] }] }
  const read = vi.fn(async (_args: { where: { id: { equals: number } } }) => content as typeof content | null)
  Object.assign(context.payload.db, { findOne: read })
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(((await snapshots())[0]!.snapshot as Snapshot).health).toEqual([{ code: 'goal-in-some-versions', metricId: 'click', name: 'Join clicks' }])
  content.layout[0]!.slots[1]!.blocks.push({ blockType: 'cta', xpGoal: 'join' })
  read.mockImplementation(async ({ where }) => {
    if (where.id.equals === 7 || state === 'readable') return content
    if (state === 'throwing') throw new Error('unreadable')
    return state === 'deleted' ? null : { ...content, id: 8, _status: 'draft' }
  })
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const after = await snapshots()
  expect(after).toHaveLength(2)
  expect((after[1]!.snapshot as Snapshot).health).toEqual(state === 'throwing'
    ? [{ code: 'goal-in-some-versions', metricId: 'click', name: 'Join clicks' },
      { code: 'placement-unchecked', detail: { collection: 'pages', id: 8 } }] : [])
  read.mockImplementation(async () => content)
  clock += 1000
  await runResults(context.payload, { sweep: false })
  expect(((await snapshots()).at(-1)!.snapshot as Snapshot).health).toEqual([])
}, 5_000) // Measured 11 ms locally; cap exceeds 3×.

test('partial page reads carry only unjudged goals, refresh asymmetric goals, and clear fixes after all arms are read', async () => {
  let clock = now
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  const gift = { ...clickMetric, metricId: 'gift', name: 'Gift clicks', source: 'click:gift', role: 'secondary' as const }
  const phase = await seed('visitor', { metricDefinitions: [clickMetric, gift], arms: [
    { key: 'control', label: 'Original', kind: 'control', weight: 34, pageTarget: '/a' },
    { key: 'variantA', label: 'A', kind: 'variant', weight: 33, pageTarget: '/b' },
    { key: 'variantB', label: 'B', kind: 'variant', weight: 33, pageTarget: '/c' },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', phase: 1, pageCollection: 'pages' }).where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => '/', contentOf: doc => doc.layout,
    findByPath: async path => ({ id: path === '/a' ? 7 : path === '/b' ? 8 : 9, published: true }),
  }] }
  Object.assign(context.payload.config, { collections: [{ slug: 'pages', fields: [] }] })
  let stage = 0
  Object.assign(context.payload.db, { findOne: vi.fn(async ({ where }: { where: { id: { equals: number } } }) => {
    const id = where.id.equals
    if (stage === 1 && id === 9) throw new Error('unreadable')
    return { id, layout: id === 7 || stage === 2 ? [{ xpGoal: 'join' }, { xpGoal: 'gift' }] : stage === 1 ? [{ xpGoal: 'join' }] : [] }
  }) })
  const amber = (metricId: string, name: string) => ({ code: 'goal-in-some-versions', metricId, name })
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(((await snapshots())[0]!.snapshot as Snapshot).health).toEqual([amber('click', 'Join clicks'), amber('gift', 'Gift clicks')])
  // The carried row keeps its old name; a freshly judged asymmetry uses the current definition.
  await database.db.update(xp_phases).set({ metricDefinitions: [{ ...clickMetric, name: 'Join refreshed' }, { ...gift, name: 'Gift refreshed' }] }).where(eq(xp_phases.experiment, Number(phase.experiment)))
  stage = 1
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(((await snapshots()).at(-1)!.snapshot as Snapshot).health).toEqual([
    amber('click', 'Join clicks'), amber('gift', 'Gift refreshed'),
    { code: 'placement-unchecked', detail: { collection: 'pages', path: '/c' } },
  ])
  stage = 2
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(((await snapshots()).at(-1)!.snapshot as Snapshot).health).toEqual([])
}, 5_000) // Measured 12 ms locally; cap exceeds 3×.

test('frozen goal health ignores new read failures and writes exactly once to clear stored unchecked health on recovery', async () => {
  let clock = now
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  const phase = await seed('visitor', { metricDefinitions: [clickMetric], endedAt: new Date(start + 1000).toISOString() })
  await database.db.update(xp_experiments).set({ kind: 'block', phase: 1, status: 'decided', decision_winnerArm: 'variantA' }).where(eq(xp_experiments.id, Number(phase.experiment)))
  await database.db.update(xp_phases).set({ placementDocs: [{ collection: 'pages', id: 7 }, { collection: 'pages', id: 8 }] }).where(eq(xp_phases.experiment, Number(phase.experiment)))
  const context = payload()
  context.options.blocks = { collections: [{ slug: 'pages', field: 'layout' }] }
  Object.assign(context.payload.config, { collections: [{ slug: 'pages', fields: [] }] })
  const content = { id: 7, layout: [{ blockType: 'xpExperiment', experiment: `frozen-${serial}`, slots: [
    { slot: 'control', blocks: [{ blockType: 'cta', xpGoal: 'join' }] }, { slot: 'variantA', blocks: [{ blockType: 'cta', xpGoal: 'join' }] },
  ] }] }
  let unreadable = false
  Object.assign(context.payload.db, { findOne: vi.fn(async ({ where }: { where: { id: { equals: number } } }) => {
    if (unreadable && where.id.equals === 8) throw new Error('unreadable')
    return content
  }) })
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const original = (await snapshots())[0]!.snapshot as Snapshot
  expect(original.health).toEqual([])
  const clean = await snapshots()
  unreadable = true
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(await snapshots()).toEqual(clean)
  content.layout[0]!.slots[1]!.blocks = []
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const changed = await snapshots()
  const health = [{ code: 'goal-in-some-versions', metricId: 'click', name: 'Join clicks' },
    { code: 'placement-unchecked', detail: { collection: 'pages', id: 8 } }]
  expect(changed).toHaveLength(2)
  expect(changed[1]!.snapshot).toEqual({ ...original, computedAt: new Date(clock).toISOString(), health })
  unreadable = false
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const recovered = await snapshots()
  expect(recovered).toHaveLength(3)
  expect(recovered[2]!.snapshot).toEqual({ ...original, computedAt: new Date(clock).toISOString(), health: [health[0]!] })
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(await snapshots()).toEqual(recovered)
  content.layout[0]!.slots[1]!.blocks.push({ blockType: 'cta', xpGoal: 'join' })
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const fixed = await snapshots()
  expect(fixed).toHaveLength(4)
  expect(fixed[3]!.snapshot).toEqual({ ...original, computedAt: new Date(clock).toISOString() })
}, 5_000) // Measured 14 ms locally; cap exceeds 3×.

test.each(['running', 'decided'] as const)('page goal health reads published page content using served arms (%s)', async status => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { metricDefinitions: [clickMetric], arms: [
    { key: 'control', label: 'Original', kind: 'control', weight: 34, pageTarget: '/a' }, { key: 'variantA', label: 'Winner', kind: 'variant', weight: 33, pageTarget: '/b' },
    { key: 'variantB', label: 'Loser', kind: 'variant', weight: 33, pageTarget: '/loser' },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', phase: 1, status, decision_winnerArm: status === 'decided' ? 'variantA' : null, pageCollection: 'pages' }).where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  const findByPath = vi.fn(async (path: string) => ({ id: path === '/loser' ? 8 : 7, published: true }))
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => '/', findByPath, contentOf: doc => doc.layout }] }
  Object.assign(context.payload.config, { collections: [{ slug: 'pages', versions: { drafts: true } }] })
  Object.assign(context.payload.db, { findOne: vi.fn(async (args: { where: { id: { equals: number } } }) => ({ id: args.where.id.equals, _status: 'published', layout: args.where.id.equals === 7 ? [{ xpGoal: 'join' }] : [] })) })
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(((await snapshots())[0]!.snapshot as Snapshot).health).toEqual(status === 'running' ? [{ code: 'goal-in-some-versions', metricId: 'click', name: 'Join clicks' }] : [])
  expect(findByPath.mock.calls.some(([path]) => path === '/loser')).toBe(status === 'running')
}, 5_000) // Measured 5 ms locally; cap exceeds 3×.

test.each([false, true])('results show a never-readable placement and readable-arm asymmetry (disagree: %s)', async disagree => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const phase = await seed('visitor', { metricDefinitions: [clickMetric], arms: [
    { key: 'control', label: 'Original', kind: 'control', weight: 34, pageTarget: '/a' },
    { key: 'variantA', label: 'A', kind: 'variant', weight: 33, pageTarget: '/b' },
    { key: 'variantB', label: 'B', kind: 'variant', weight: 33, pageTarget: '/unreadable' },
  ] })
  await database.db.update(xp_experiments).set({ kind: 'page', phase: 1, pageCollection: 'pages' }).where(eq(xp_experiments.id, Number(phase.experiment)))
  const context = payload()
  context.options.pages = { collections: [{ slug: 'pages', pathOf: () => '/', findByPath: async path => ({ id: path === '/a' ? 7 : path === '/b' ? 8 : 9, published: true }), contentOf: doc => doc.layout }] }
  Object.assign(context.payload.config, { collections: [{ slug: 'pages', fields: [] }] })
  Object.assign(context.payload.db, { findOne: vi.fn(async ({ where }: { where: { id: { equals: number } } }) => {
    const id = where.id.equals
    if (id === 9) throw new Error('unreadable')
    return { id, layout: disagree && id === 8 ? [] : [{ xpGoal: 'join' }] }
  }) })
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  expect(((await snapshots())[0]!.snapshot as Snapshot).health).toEqual([
    ...(disagree ? [{ code: 'goal-in-some-versions', metricId: 'click', name: 'Join clicks' }] : []),
    { code: 'placement-unchecked', detail: { collection: 'pages', path: '/unreadable' } },
  ])
}, 5_000) // Measured 7 ms locally; cap exceeds 3×.

test.each([
  { kind: 'block', frozen: false }, { kind: 'page', frozen: false }, { kind: 'puck', frozen: false },
  { kind: 'block', frozen: true }, { kind: 'page', frozen: true }, { kind: 'puck', frozen: true },
] as const)('an unchecked goal-bearing placement retains amber until a complete symmetric read ($kind, frozen: $frozen)', async ({ kind, frozen }) => {
  let clock = now
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  const phase = await seed('visitor', { metricDefinitions: [clickMetric],
    arms: [
      { key: 'control', label: 'Original', kind: 'control', weight: 50, pageTarget: '/8' },
      { key: 'variantA', label: 'Variant', kind: 'variant', weight: 50, pageTarget: '/7' },
    ], ...(frozen ? { endedAt: new Date(start + 1000).toISOString() } : {}),
  })
  await database.db.update(xp_experiments).set({ kind: kind === 'page' ? 'page' : 'block', phase: 1, pageCollection: 'pages',
    status: frozen ? 'decided' : 'running', decision_winnerArm: frozen ? 'variantA' : null,
  }).where(eq(xp_experiments.id, Number(phase.experiment)))
  await database.db.update(xp_phases).set({ placementDocs: [7, 8].map(id => ({ collection: 'pages', id })) })
    .where(eq(xp_phases.experiment, Number(phase.experiment)))
  const context = payload()
  context.options.blocks = { collections: [{ slug: 'pages', field: 'layout', appliesTo: () => kind !== 'puck' }] }
  context.options.puck = { enabled: kind === 'puck', collections: ['pages'] }
  context.options.pages = { collections: [{ slug: 'pages', pathOf: doc => `/${doc.id}`, contentOf: doc => doc.layout,
    findByPath: async path => ({ id: Number(path.slice(1)), published: true }),
  }] }
  Object.assign(context.payload.config, { collections: [{ slug: 'pages', fields: [] }] })
  let stage = 0
  Object.assign(context.payload.db, { findOne: vi.fn(async ({ where }: { where: { id: { equals: number } } }) => {
    const id = where.id.equals
    if (stage === 1 && id === 8) throw new Error('unreadable')
    const control = stage < 2 && id === 8 ? [{ blockType: 'cta', xpGoal: 'join' }] : []
    return { id, layout: kind === 'page' ? control : [{ blockType: 'xpExperiment', experiment: `frozen-${serial}`,
      slots: [{ slot: 'control', blocks: control }, { slot: 'variantA', blocks: [] }],
    }], puckData: { content: [{ type: 'ExperimentSlot', props: { experiment: `frozen-${serial}`, control, variantA: [] } }] } }
  }) })
  const amber = [{ code: 'goal-in-some-versions', metricId: 'click', name: 'Join clicks' }]
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const before = await snapshots()
  expect((before[0]!.snapshot as Snapshot).health).toEqual(amber)
  stage = 1
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const partial = await snapshots()
  if (frozen) expect(partial).toEqual(before)
  else expect((partial.at(-1)!.snapshot as Snapshot).health).toEqual([...amber, { code: 'placement-unchecked',
    detail: kind === 'page' ? { collection: 'pages', path: '/8' } : { collection: 'pages', id: 8 },
  }])
  stage = 2
  clock += 1000
  expect(await runResults(context.payload, { sweep: false })).toMatchObject({ ran: 1, failed: 0 })
  const recovered = await snapshots()
  expect(recovered).toHaveLength(frozen ? 2 : 3)
  expect((recovered.at(-1)!.snapshot as Snapshot).health).toEqual([])
}, 5_000) // Measured 9 ms locally; cap exceeds 3×.

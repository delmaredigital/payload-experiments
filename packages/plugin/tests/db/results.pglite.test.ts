import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { insertEvents, type EventRow } from '../../src/db/events.js'
import { pooledExecutor, type Executor } from '../../src/db/executor.js'
import { insertIdentity } from '../../src/db/identities.js'
import { armMismatchCount, identityRows, metricEventRows, phaseExposureRows, rolloutExposureRows } from '../../src/db/results.js'
import { firstExposures, perUnitValues } from '../../src/results/aggregate.js'
import { creditUserEvents } from '../../src/results/identityCredit.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { xp_experiments } from '../_fixtures/generated-schema.js'

let database: Awaited<ReturnType<typeof createPgliteDb>>
let exec: Executor
let experimentId: number
const start = Date.parse('2026-10-31T10:00:00.123Z')
const end = start + 3_600_000
let serial = 0
const event = (overrides: Partial<EventRow>): EventRow => ({ type: 'exposure', experimentId, phase: 1, arm: 'control', unitId: 'visitor', unitType: 'visitor', ts: new Date(start).toISOString(), dedupeKey: `results-${++serial}`, ...overrides })

beforeAll(async () => {
  database = await createPgliteDb()
  exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
  const [experiment] = await database.db.insert(xp_experiments).values({ name: 'Results', slug: 'results', kind: 'code', exposurePolicy: 'manual' }).returning()
  experimentId = experiment!.id
  await insertEvents(exec, [
    event({ unitId: 'a', ts: '2026-10-31T12:00:00.123+02:00' }),
    event({ unitId: 'b' }),
    event({ unitId: 'multi', arm: 'control' }),
    event({ unitId: 'multi', arm: 'variantA', ts: new Date(start + 1).toISOString() }),
    event({ unitId: 'a', ts: new Date(start + 2).toISOString() }),
    event({ unitId: 'late', ts: new Date(end).toISOString() }),
    event({ unitId: 'later', ts: new Date(end + 1).toISOString() }),
    event({ unitId: 'a', phase: 2, ts: new Date(end + 2).toISOString() }),
    event({ unitId: 'new-rollout', phase: 2, ts: new Date(end + 3).toISOString() }),
    event({ type: 'arm-mismatch', unitId: 'mismatch' }),
    event({ type: 'arm-mismatch', unitId: 'mismatch', ts: new Date(start + 1).toISOString() }),
    event({ type: 'arm-mismatch', unitId: 'mismatch-2' }),
    event({ type: 'arm-mismatch', unitId: 'mismatch-late', ts: new Date(end).toISOString() }),
    event({ type: 'arm-mismatch', unitId: 'mismatch-phase-2', phase: 2 }),
    event({ type: 'exposure', experimentId: undefined, unitId: 'orphan' }),
  ])
}, 60_000)
afterAll(async () => { await database?.close() })

test('phase rows retain repeats and multiple arms, ordered by time/unit; endedAt is strict', async () => {
  const rows = await phaseExposureRows(exec, { experimentId, phase: 1, endedAt: end })
  expect(rows).toEqual([
    { unitId: 'a', arm: 'control', ts: start },
    { unitId: 'b', arm: 'control', ts: start },
    { unitId: 'multi', arm: 'control', ts: start },
    { unitId: 'multi', arm: 'variantA', ts: start + 1 },
    { unitId: 'a', arm: 'control', ts: start + 2 },
  ])
  const exposed = firstExposures(rows)
  expect([...exposed.units.keys()]).toEqual(['a', 'b'])
  expect(exposed.excludedMultiArm).toBe(1)
  expect(await phaseExposureRows(exec, { experimentId, phase: 1 })).toHaveLength(7)
  expect(await phaseExposureRows(exec, { experimentId, phase: 99 })).toEqual([])
})

test('arm mismatches count distinct units in the requested phase/cut-off only', async () => {
  expect(await armMismatchCount(exec, { experimentId, phase: 1, endedAt: end })).toBe(2)
  expect(await armMismatchCount(exec, { experimentId, phase: 1 })).toBe(3)
  expect(await armMismatchCount(exec, { experimentId, phase: 99 })).toBe(0)
})

test('rollout rows include all phases and prior exposures, but no mismatches or other experiments', async () => {
  const rows = await rolloutExposureRows(exec, { experimentId })
  expect(rows).toHaveLength(9)
  expect(rows.filter(row => row.unitId === 'a')).toEqual([
    { unitId: 'a', phase: 1, ts: start },
    { unitId: 'a', phase: 1, ts: start + 2 },
    { unitId: 'a', phase: 2, ts: end + 2 },
  ])
  expect(rows.at(-1)).toEqual({ unitId: 'new-rollout', phase: 2, ts: end + 3 })
  expect(rows.every(row => typeof row.ts === 'number' && typeof row.phase === 'number')).toBe(true)
})

test('conversion rows enforce [from,to), event name/type, and carry both identity keys', async () => {
  await insertEvents(exec, [
    event({ type: 'conversion', eventName: 'signup', value: 1, unitId: 'a', ts: new Date(start - 1).toISOString() }),
    event({ type: 'conversion', eventName: 'signup', value: 1, unitId: 'a' }),
    event({ type: 'conversion', eventName: 'signup', value: 2.5, unitId: 'signed-in', userId: '42', ts: new Date(end - 1).toISOString() }),
    event({ type: 'conversion', eventName: 'signup', value: 100, unitId: 'a', ts: new Date(end).toISOString() }),
    event({ type: 'conversion', eventName: 'other', value: 100, unitId: 'a' }),
    event({ type: 'arm-mismatch', eventName: 'signup', value: 100, phase: 3 }),
  ])
  const rows = await metricEventRows(exec, { eventName: 'signup', from: start, to: end })
  expect(rows).toEqual([
    { unitId: 'a', userId: null, value: 1, ts: start },
    { unitId: 'signed-in', userId: '42', value: 2.5, ts: end - 1 },
  ])
  expect(await metricEventRows(exec, { eventName: 'signup', unitIds: ['a'], from: start, to: end })).toEqual([rows[0]])
  expect(await metricEventRows(exec, { eventName: 'signup', userIds: ['42'], from: start, to: end })).toEqual([rows[1]])
  const { units } = firstExposures(await phaseExposureRows(exec, { experimentId, phase: 1, endedAt: end }))
  expect([...perUnitValues(units, rows, { kind: 'binomial', windowHours: 1, endedAt: end })]).toEqual([['a', 1], ['b', 0]])
  await insertIdentity(exec, { verified: false, anonymousId: 'a', userId: '42' })
  const identities = await identityRows(exec, { anonymousIds: ['missing', 'a', 'a'] })
  expect(identities).toEqual([{ anonymousId: 'a', userId: '42', verifiedAt: null, ownedAt: null }])
  expect(creditUserEvents(units, identities, rows.filter(row => row.userId !== null).map(row => ({ ...row, userId: row.userId! }))).events).toEqual([{ unitId: 'a', value: 2.5, ts: end - 1 }])
})

test('25,000 requested units and identities cross both ANY batch boundaries without loss or duplicates', async () => {
  const ids = Array.from({ length: 25_000 }, (_, n) => `batch-${n}`)
  const selected = [ids[0]!, ids[9_999]!, ids[10_000]!, ids[19_999]!, ids[20_000]!, ids[24_999]!]
  await insertEvents(exec, selected.map(unitId => event({ type: 'conversion', eventName: 'batch-event', value: 1, unitId })))
  for (const [n, anonymousId] of selected.entries()) await insertIdentity(exec, { verified: false, anonymousId, userId: String(n) })
  const rows = await metricEventRows(exec, { eventName: 'batch-event', unitIds: [...ids, ids[0]!], from: start, to: end })
  expect(rows.map(row => row.unitId).sort()).toEqual([...selected].sort())
  expect(rows.every(row => row.ts === start && row.value === 1)).toBe(true)
  const identities = await identityRows(exec, { anonymousIds: [...ids, ids[0]!] })
  expect(identities.sort((a, b) => a.anonymousId.localeCompare(b.anonymousId))).toEqual(selected.map((anonymousId, n) => ({ anonymousId, userId: String(n), verifiedAt: null, ownedAt: null })).sort((a, b) => a.anonymousId.localeCompare(b.anonymousId)))
})

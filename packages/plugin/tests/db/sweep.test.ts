import type { Payload } from 'payload'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { sweepEvents } from '../../src/db/sweep.js'
import { insertEvents, type EventRow } from '../../src/db/events.js'
import { pooledExecutor } from '../../src/db/executor.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { xp_events, xp_experiments, xp_phases } from '../_fixtures/generated-schema.js'

test('sweep checks budget before every statement and batches each predicate separately', async () => {
  const exec = createFakeExecutor({ results: [
    { rows: [], rowCount: 2 }, { rows: [], rowCount: 2 }, { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 }, { rows: [{ experimentId: 7 }] }, { rows: [], rowCount: 2 }, { rows: [], rowCount: 0 },
    { rows: [{ revision: 3, before: null }] }, { rows: [], rowCount: 1 },
  ] })
  const now = new Date('2026-10-31'), cutoff = '2026-05-04T00:00:00.000Z'
  expect(await sweepEvents(exec, { now, batchSize: 2 })).toBe(9)
  expect(exec.calls).toHaveLength(9)
  expect(exec.calls[0]!.params).toEqual(['exposure', 2])
  expect(exec.calls[3]!.params).toEqual(['arm-mismatch', 2])
  expect(exec.calls[4]!.params).toEqual([cutoff])
  expect(exec.calls[5]!.params).toEqual([[7], cutoff, 2])
  expect(exec.calls[8]!.params).toEqual([cutoff, 3, 2])
  for (let allowed = 0; allowed <= 6; allowed++) {
    let queries = 0
    const limited = createFakeExecutor({ results: [{ rows: [] }, { rows: [] }, { rows: [{ experimentId: 7 }] }, { rows: [] }, { rows: [] }, { rows: [] }] })
    const query = limited.query.bind(limited)
    limited.query = (...args) => { queries++; return query(...args) }
    await sweepEvents(limited, { now, shouldContinue: () => queries < allowed })
    expect(queries).toBe(allowed)
  }
  await expect(sweepEvents(exec, { now, batchSize: 0 })).rejects.toThrow('Invalid retention')
})

test('PGlite: an old stopped test plus open rollout keeps all rows until final endedAt + 180 days', async () => {
  const database = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
    const [experiment] = await database.db.insert(xp_experiments).values({ name: 'Sweep', slug: 'sweep', kind: 'code', exposurePolicy: 'manual' }).returning()
    const id = experiment!.id, now = new Date('2026-10-31T00:00:00Z')
    for (const [phase, endedAt] of [[1, '2026-01-02T00:00:00Z'], [2, null]] as const) {
      await database.db.insert(xp_phases).values({ experiment: id, phase, phaseKind: phase === 1 ? 'test' : 'rollout', seed: 'sweep|', startedAt: '2026-01-01T00:00:00Z', endedAt })
    }
    let serial = 0
    const event = (overrides: Partial<EventRow>): EventRow => ({ type: 'exposure', experimentId: id, phase: 1, arm: 'control', unitId: 'a', unitType: 'visitor', ts: '2026-01-01T00:00:00Z', dedupeKey: `sweep-${++serial}`, ...overrides })
    await insertEvents(exec, [event({}), event({}), event({ phase: 2 }),
      event({ experimentId: undefined }), event({ experimentId: undefined, type: 'arm-mismatch' }),
      event({ experimentId: undefined, type: 'conversion', eventName: 'signup', value: 1 }),
      event({ experimentId: undefined, type: 'conversion', eventName: 'signup', value: 1, ts: '2025-12-31T00:00:00Z' })])
    expect(await sweepEvents(exec, { now, batchSize: 2 })).toBe(2)
    const remaining = await database.db.select().from(xp_events)
    expect(remaining.map(row => row.phase).sort()).toEqual([1, 1, 1, 1, 2])
    expect(remaining.filter(row => row.type === 'conversion')).toHaveLength(2)
    // Release holdout: the final end starts the clock for every event, including
    // the old test history needed by rollout's first-ever exposure rule.
    await database.db.update(xp_phases).set({ endedAt: now.toISOString() }).where(eq(xp_phases.phase, 2))
    const expires = new Date(+now + 180 * 86_400_000)
    expect(await sweepEvents(exec, { now: expires, batchSize: 2 })).toBe(0)
    expect(await sweepEvents(exec, { now: new Date(+expires + 1), batchSize: 2 })).toBe(5)
    expect(await database.db.select().from(xp_events)).toEqual([])
  } finally { await database.close() }
}, 60_000)


test('deleted experiments become NULL rows and are swept by the remaining branches', async () => {
  const database = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
    const [experiment] = await database.db.insert(xp_experiments).values({ name: 'Deleted', slug: 'deleted', kind: 'code', exposurePolicy: 'manual' }).returning()
    const rows: EventRow[] = ['exposure', 'arm-mismatch', 'conversion'].map((type, i) => ({
      type: type as EventRow['type'], experimentId: experiment!.id, phase: 1, arm: 'control',
      unitId: 'a', unitType: 'visitor', ts: '2020-01-01T00:00:00Z', dedupeKey: `deleted-${i}`,
    }))
    await insertEvents(exec, rows)
    await database.db.delete(xp_experiments).where(eq(xp_experiments.id, experiment!.id))
    expect((await database.db.select().from(xp_events)).every(row => row.experiment === null)).toBe(true)
    expect(await sweepEvents(exec, { now: new Date('2026-10-31'), batchSize: 1 })).toBe(3)
    expect(await database.db.select().from(xp_events)).toEqual([])
  } finally { await database.close() }
}, 60_000)

test('a new phase between the ended-id read and delete protects all experiment history', async () => {
  const database = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
    const [experiment] = await database.db.insert(xp_experiments).values({ name: 'Restarted', slug: 'restarted', kind: 'code', exposurePolicy: 'manual' }).returning()
    const id = experiment!.id
    await database.db.insert(xp_phases).values({ experiment: id, phase: 1, phaseKind: 'test', seed: 'old|', startedAt: '2020-01-01', endedAt: '2020-02-01' })
    await insertEvents(exec, [{ type: 'exposure', experimentId: id, phase: 1, arm: 'control', unitId: 'a', unitType: 'visitor', ts: '2020-01-01', dedupeKey: 'restarted' }])
    let reopened = false
    await sweepEvents({ query: async <R>(text: string, params: unknown[] = []) => {
      const result = await exec.query<R>(text, params)
      if (text.startsWith('SELECT') && text.includes('AS "experimentId"') && !reopened) {
        reopened = true
        await database.db.insert(xp_phases).values({ experiment: id, phase: 2, phaseKind: 'test', seed: 'new|', startedAt: '2026-10-31' })
      }
      return result
    } }, { now: new Date('2026-10-31'), batchSize: 1 })
    expect(reopened).toBe(true)
    expect(await database.db.select().from(xp_events)).toHaveLength(1)
  } finally { await database.close() }
}, 60_000)

test('protected windows are read once; a mid-sweep start invalidates later conversion batches', async () => {
  const database = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
    const [experiment] = await database.db.insert(xp_experiments).values({ name: 'New', slug: 'new', kind: 'code', exposurePolicy: 'manual' }).returning()
    await exec.query('INSERT INTO xp_state (revision, created_at, updated_at) VALUES (1, now(), now())')
    await insertEvents(exec, [1, 2, 3].map(n => ({ type: 'conversion' as const, unitId: `a${n}`, unitType: 'visitor' as const, ts: '2026-10-25', dedupeKey: `new-${n}` })))
    let windows = 0, started = false
    const swept = await sweepEvents({ query: async <R>(text: string, params: unknown[] = []) => {
      const result = await exec.query<R>(text, params)
      if (text.includes('min(w."from")')) windows++
      if (text.startsWith('DELETE') && text.includes("= 'conversion'") && !started) {
        started = true
        await database.db.insert(xp_phases).values({ experiment: experiment!.id, phase: 1, phaseKind: 'test', seed: 'new|', startedAt: '2026-10-31' })
        await exec.query('UPDATE xp_state SET revision = revision + 1')
      }
      return result
    } }, { now: new Date('2026-10-31'), retentionDays: 1, batchSize: 1 })
    expect(swept).toBe(1)
    expect(windows).toBe(1)
    expect(await database.db.select().from(xp_events)).toHaveLength(2)
    // A fresh run includes the new phase's two-week lookback.
    expect(await sweepEvents(exec, { now: new Date('2026-10-31'), retentionDays: 1, batchSize: 1 })).toBe(0)
  } finally { await database.close() }
}, 60_000)

import type { Payload } from 'payload'
import { eq } from 'drizzle-orm'
import { expect, test, vi } from 'vitest'
import { sweepEvents } from '../../src/db/sweep.js'
import { insertEvents, type EventRow } from '../../src/db/events.js'
import { pooledExecutor, ResultsBudgetError } from '../../src/db/executor.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { xp_events, xp_experiments, xp_phases } from '../_fixtures/generated-schema.js'

test('sweep batches until fewer than batchSize deleted and checks budget between batches', async () => {
  const exec = createFakeExecutor({ results: [{ rows: [], rowCount: 2 }, { rows: [], rowCount: 2 }, { rows: [], rowCount: 1 }] })
  expect(await sweepEvents(exec, { now: new Date('2026-10-31'), batchSize: 2 })).toBe(5)
  expect(exec.calls).toHaveLength(3)
  expect(exec.calls[0]!.params).toEqual(['2026-05-04T00:00:00.000Z', 2])
  let n = 0
  expect(await sweepEvents(exec, { now: new Date(), shouldContinue: () => n++ < 1 })).toBe(0)
  await expect(sweepEvents(exec, { now: new Date(), batchSize: 0 })).rejects.toThrow('Invalid retention')
})

test.each([0, 2])('budget cancellation warns once only when no rows were deleted (%s)', async swept => {
  const logger = { warn: vi.fn() }, failure = new ResultsBudgetError()
  const exec = createFakeExecutor()
  let queries = 0
  exec.query = async () => {
    if (swept && queries++ === 0) return { rows: [], rowCount: swept }
    throw failure
  }
  await expect(sweepEvents(exec, { now: new Date(), batchSize: 2, logger })).rejects.toBe(failure)
  if (swept) expect(logger.warn).not.toHaveBeenCalled()
  else expect(logger.warn).toHaveBeenCalledExactlyOnceWith('Experiment retention sweep made no progress before its budget expired; eligible rows may remain.')
})

test('an empty sweep or unrelated SQL error does not warn about budget cancellation', async () => {
  const logger = { warn: vi.fn() }, exec = createFakeExecutor()
  expect(await sweepEvents(exec, { now: new Date(), logger })).toBe(0)
  exec.query = async () => { throw Object.assign(new Error('SQL failed'), { code: '23505' }) }
  await expect(sweepEvents(exec, { now: new Date(), logger })).rejects.toThrow('SQL failed')
  expect(logger.warn).not.toHaveBeenCalled()
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

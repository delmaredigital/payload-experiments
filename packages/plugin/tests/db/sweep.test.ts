import type { Payload } from 'payload'
import { expect, test } from 'vitest'
import { sweepEvents } from '../../src/db/sweep.js'
import { insertEvents, type EventRow } from '../../src/db/events.js'
import { pooledExecutor } from '../../src/db/executor.js'
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

test('PGlite: retention follows endedAt, keeps open phases and sweeps NULL orphans in batches', async () => {
  const database = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
    const [experiment] = await database.db.insert(xp_experiments).values({ name: 'Sweep', slug: 'sweep', kind: 'code', exposurePolicy: 'manual' }).returning()
    const id = experiment!.id, now = new Date('2026-10-31T00:00:00Z')
    for (const [phase, endedAt] of [[1, '2026-01-02T00:00:00Z'], [2, null], [3, '2026-10-30T00:00:00Z'], [4, '2026-05-04T00:00:00Z']] as const) {
      await database.db.insert(xp_phases).values({ experiment: id, phase, phaseKind: 'test', seed: 'sweep|', startedAt: '2026-01-01T00:00:00Z', endedAt })
    }
    let serial = 0
    const event = (overrides: Partial<EventRow>): EventRow => ({ type: 'exposure', experimentId: id, phase: 1, arm: 'control', unitId: 'a', unitType: 'visitor', ts: '2026-01-01T00:00:00Z', dedupeKey: `sweep-${++serial}`, ...overrides })
    await insertEvents(exec, [event({}), event({}), event({ phase: 2 }), event({ phase: 3 }), event({ phase: 4 }),
      event({ experimentId: undefined }), event({ experimentId: undefined, type: 'arm-mismatch' }),
      event({ experimentId: undefined, type: 'conversion', eventName: 'signup', value: 1 }),
      event({ experimentId: undefined, type: 'conversion', eventName: 'signup', value: 1, ts: '2025-12-31T00:00:00Z' })])
    expect(await sweepEvents(exec, { now, batchSize: 2 })).toBe(4)
    const remaining = await database.db.select().from(xp_events)
    expect(remaining.map(row => row.phase).sort()).toEqual([1, 1, 2, 3, 4])
    expect(remaining.filter(row => row.type === 'conversion')).toHaveLength(2)
  } finally { await database.close() }
}, 60_000)

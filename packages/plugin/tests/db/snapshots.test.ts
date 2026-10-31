import type { Payload } from 'payload'
import { expect, test } from 'vitest'
import { newestSnapshotIds } from '../../src/db/snapshots.js'
import { pooledExecutor } from '../../src/db/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { xp_experiments, xp_results_snapshots } from '../_fixtures/generated-schema.js'

test('PGlite newest snapshot pointers select one per phase or experiment, with stable ties', async () => {
  const database = await createPgliteDb()
  try {
    const [experiment] = await database.db.insert(xp_experiments).values({ name: 'Pointers', slug: 'pointers', kind: 'code', exposurePolicy: 'manual' }).returning()
    const id = experiment!.id
    const rows = await database.db.insert(xp_results_snapshots).values([
      { experiment: id, phase: 1, computedAt: '2026-10-01T00:00:00Z', window: {}, snapshot: {} },
      { experiment: id, phase: 1, computedAt: '2026-10-02T00:00:00Z', window: {}, snapshot: {} },
      { experiment: id, phase: 1, computedAt: '2026-10-02T00:00:00Z', window: {}, snapshot: {} },
      { experiment: id, phase: 2, computedAt: '2026-10-03T00:00:00Z', window: {}, snapshot: {} },
    ]).returning()
    const exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
    expect(await newestSnapshotIds(exec, [id], 'phase')).toEqual([rows[2]!.id, rows[3]!.id])
    expect(await newestSnapshotIds(exec, [id], 'experiment')).toEqual([rows[3]!.id])
    expect(await newestSnapshotIds(exec, [], 'experiment')).toEqual([])
  } finally { await database.close() }
}, 60_000)

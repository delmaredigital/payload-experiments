import type { Payload } from 'payload'
import { expect, test } from 'vitest'
import { newestSnapshotIds, resultsCandidates, resultsMetadata } from '../../src/db/snapshots.js'
import { pooledExecutor } from '../../src/db/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { xp_experiments, xp_phases, xp_results_snapshots } from '../_fixtures/generated-schema.js'

test('PGlite results metadata and newest snapshot pointers select the expected fields and stable ties', async () => {
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
    expect(await resultsMetadata(exec, id)).toEqual({ name: 'Pointers', kind: 'code', status: 'draft', snapshotId: null, winnerArm: null })
    expect(await newestSnapshotIds(exec, [id], 'phase')).toEqual([rows[2]!.id, rows[3]!.id])
    expect(await newestSnapshotIds(exec, [id], 'experiment')).toEqual([rows[3]!.id])
    expect(await newestSnapshotIds(exec, [], 'experiment')).toEqual([])
  } finally { await database.close() }
}, 60_000)

test('PGlite analysis queue orders never computed, old, then recent snapshots', async () => {
  const database = await createPgliteDb()
  try {
    // Insert in the opposite order so the id tie-break cannot produce the expected order.
    const experiments = await database.db.insert(xp_experiments).values(['recent', 'old', 'never'].map(slug => ({
      name: slug, slug, kind: 'code' as const, exposurePolicy: 'manual' as const, status: 'running' as const, phase: 1,
    }))).returning()
    await database.db.insert(xp_phases).values(experiments.map(({ id }) => ({
      experiment: id, phase: 1, phaseKind: 'test' as const, startedAt: '2026-10-01T00:00:00Z', seed: 'queue', arms: [],
    })))
    await database.db.insert(xp_results_snapshots).values([
      { experiment: experiments[0]!.id, phase: 1, computedAt: '2026-10-03T00:00:00Z', window: {}, snapshot: {} },
      { experiment: experiments[1]!.id, phase: 1, computedAt: '2026-10-02T00:00:00Z', window: {}, snapshot: {} },
    ])
    const exec = pooledExecutor({ db: { drizzle: database.db } } as unknown as Payload)
    const queue = await resultsCandidates(exec, { cutoff: '2026-10-01T00:00:00Z' })
    expect(queue.map(candidate => candidate.phase.experiment)).toEqual([
      experiments[2]!.id, experiments[1]!.id, experiments[0]!.id,
    ])
    expect(queue.map(candidate => candidate.latestComputedAt)).toEqual([
      null, expect.stringContaining('2026-10-02'), expect.stringContaining('2026-10-03'),
    ])
  } finally { await database.close() }
}, 60_000)

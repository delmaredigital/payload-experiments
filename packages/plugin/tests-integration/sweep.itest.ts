import { expect, test } from 'vitest'
import { sweepEvents } from '../src/db/sweep.js'
import { insertEvents } from '../src/db/events.js'
import { pooledExecutor, type Executor } from '../src/db/executor.js'
import { createIntegrationHarness } from './harness.js'
import { batchSize, eventIndexes, measureSweepPlans } from '../tests/_helpers/sweepPlans.js'

// Written for the merged-main Postgres train; never run in the feature lane.
test('sweep keeps test history through an open rollout and deletes after the final end plus retention', async () => {
  const harness = await createIntegrationHarness()
  try {
    const { payload } = harness
    const experiment = await payload.create({ collection: 'xp-experiments', overrideAccess: true, data: {
      name: 'Retention', slug: 'retention', kind: 'code', unitType: 'visitor', exposurePolicy: 'manual',
    } })
    for (const [phase, endedAt] of [[1, '2025-01-02T00:00:00Z'], [2, null]] as const) {
      await payload.create({ collection: 'xp-phases', overrideAccess: true, data: {
        experiment: experiment.id, phase, phaseKind: 'test', startedAt: '2025-01-01T00:00:00Z', endedAt, seed: 'retention|',
      } })
    }
    const exec = pooledExecutor(payload)
    await insertEvents(exec, [1, 1, 1, 2].map((phase, n) => ({ type: 'exposure' as const, experimentId: experiment.id, phase,
      arm: 'control', unitId: `retention-${n}`, unitType: 'visitor' as const, ts: '2025-01-01T00:00:00Z', dedupeKey: `retention-${n}` })))
    const finalEnd = new Date('2026-10-31T00:00:00Z')
    expect(await sweepEvents(exec, { now: finalEnd, batchSize: 2 })).toBe(0)
    const phases = await payload.find({ collection: 'xp-phases', overrideAccess: true, where: { and: [{ experiment: { equals: experiment.id } }, { phase: { equals: 2 } }] } })
    await payload.update({ collection: 'xp-phases', id: phases.docs[0]!.id, overrideAccess: true, data: { endedAt: finalEnd.toISOString() } })
    expect(await sweepEvents(exec, { now: new Date(+finalEnd + 181 * 86_400_000), batchSize: 2 })).toBe(4)
    const { docs } = await payload.find({ collection: 'xp-events', overrideAccess: true, where: { experiment: { equals: experiment.id } } })
    expect(docs).toHaveLength(0)
  } finally { await harness.teardown() }
}, 60_000)

// Production uses postgres:17; PGlite's PG 18 skip scan must not mask a bad plan.
// 50k initial events, growing to 60k/80k as conversions scale 10k/20k/40k.
test.each(['integer', 'uuid'] as const)('%s: retention branches use selective indexes with flat batch cost on Postgres', async idType => {
  const harness = await createIntegrationHarness()
  try {
    const client = await harness.pool.connect()
    const schema = `"${harness.schemaName}_sweep_${idType}"`
    try {
      await client.query(`CREATE SCHEMA ${schema}`)
      try {
        const exec: Executor = { query: async <R>(text: string, params: unknown[] = []) => {
          const result = await client.query(text, params)
          return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 }
        } }
        const result = await measureSweepPlans(exec, async sql => {
          // The helper has begun its transaction on this same checked-out client.
          await client.query(`SET LOCAL search_path TO ${schema}`)
          await client.query(sql)
        }, idType, 50_000)
        const summary = JSON.stringify({ idType, baseEvents: 50_000, measurements: result.measurements.map(scale => ({
          ...scale, branches: scale.branches.map(({ plan: _plan, sql: _sql, ...branch }) => branch),
        })) }, null, 2)
        try {
          expect(result.physicalIndexes).toEqual(['xp_events_pkey', ...eventIndexes.map(index => index.name)].sort())
          expect(result.measurements.map(scale => scale.scale)).toEqual([1, 2, 4])
          for (const scale of result.measurements) {
            expect(scale.branches).toHaveLength(4)
            expect(scale.windowReads).toBe(1)
            expect(scale.emptyExamined).toBeLessThanOrEqual(batchSize)
            for (const branch of scale.branches) {
              expect(branch.scanTypes).not.toHaveLength(0)
              // PostgreSQL 17 plans a small selective set as a Bitmap Heap Scan over a Bitmap Index
              // Scan. That is still index-served: accept it only when every bitmap child is the
              // expected index (the Index Cond, no-filter and flat-cost assertions below still apply).
              expect(branch.scanTypes.every(type => /^(Index|Index Only) Scan$/.test(type) || type === 'Bitmap Heap Scan')).toBe(true)
              for (const children of branch.bitmapIndexes) {
                expect(children).not.toHaveLength(0)
                expect(children.every(name => name === 'experiment_type_ts_idx')).toBe(true)
              }
              // A correlated phase subplan may have its own index as well.
              expect(branch.indexName).toContain('experiment_type_ts_idx')
              expect(branch.indexCond).toContain('experiment_id')
              if (branch.branch < 2 || branch.branch === 3) expect(branch.indexCond).toContain('type')
              if (branch.branch === 2) expect(branch.indexCond).toContain('ANY')
              if (branch.branch === 3) expect(branch.indexCond).toMatch(/ts < /)
              const probed = branch.branch === 2 ? /\bexperiment_id\b/ : /\b(experiment_id|type|ts)\b/
              expect(branch.filters.some(filter => probed.test(filter))).toBe(false)
              expect(branch.examined).toBeLessThanOrEqual(batchSize * 4)
            }
          }
          for (let branch = 0; branch < 4; branch++) {
            const examined = result.measurements.map(scale => scale.branches[branch]!.examined)
            expect(Math.max(...examined)).toBeLessThanOrEqual(Math.max(1, Math.min(...examined)) * 2)
          }
        } catch (error) {
          console.error(`Sweep plan summary:\n${summary}`)
          throw error
        }
      } finally { await client.query(`DROP SCHEMA ${schema} CASCADE`) }
    } finally { client.release() }
  } finally { await harness.teardown() }
}, 180_000)

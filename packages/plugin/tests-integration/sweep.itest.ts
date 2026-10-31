import { expect, test } from 'vitest'
import { sweepEvents } from '../src/db/sweep.js'
import { insertEvents } from '../src/db/events.js'
import { pooledExecutor } from '../src/db/executor.js'
import { createIntegrationHarness } from './harness.js'

// Written for the merged-main Postgres train; never run in the feature lane.
test('sweep removes ended-phase events in batches and preserves open-phase events', async () => {
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
    expect(await sweepEvents(exec, { now: new Date('2026-10-31T00:00:00Z'), batchSize: 2 })).toBe(3)
    const { docs } = await payload.find({ collection: 'xp-events', overrideAccess: true, where: { experiment: { equals: experiment.id } } })
    expect(docs).toHaveLength(1)
    expect(docs[0]!.phase).toBe(2)
  } finally { await harness.teardown() }
}, 60_000)

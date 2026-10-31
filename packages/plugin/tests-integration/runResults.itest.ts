import { expect, test } from 'vitest'
import { runResults } from '../src/server/runResults.js'
import { insertEvents } from '../src/db/events.js'
import { pooledExecutor } from '../src/db/executor.js'
import { createIntegrationHarness } from './harness.js'

// Written for the merged-main Postgres train; never run in the feature lane.
test('runResults end to end uses the phase config and user_id despite a visitor cookie', async () => {
  const harness = await createIntegrationHarness()
  try {
    const { payload } = harness
    const experiment = await payload.create({ collection: 'xp-experiments', overrideAccess: true, data: {
      name: 'Results user', slug: 'results-user', kind: 'code', unitType: 'user', exposurePolicy: 'manual',
    } })
    const start = new Date(Date.now() - 86_400_000).toISOString()
    await payload.create({ collection: 'xp-phases', overrideAccess: true, data: {
      experiment: experiment.id, phase: 1, phaseKind: 'test', startedAt: start, seed: 'results-it|', allocation: 100,
      arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50 }, { key: 'variantA', label: 'Variant', kind: 'variant', weight: 50 }],
      metricDefinitions: [{ metricId: 'frozen', name: 'Frozen signup', kind: 'binomial', source: 'events:signup', role: 'primary', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150 }],
      analysis: { method: 'sequential', cuped: 'off', minExposuresPerArm: 200, plannedDurationDays: 14, sequentialTuningParameter: 5000 },
    } })
    await payload.update({ collection: 'xp-experiments', id: experiment.id, overrideAccess: true, context: { xpTransition: true },
      data: { status: 'running', phase: 1, analysis: { method: 'bayesian', attributionWindowHours: 1 } } })
    const exec = pooledExecutor(payload)
    await insertEvents(exec, [
      { type: 'exposure', experimentId: experiment.id, phase: 1, arm: 'control', unitId: 'user-a', unitType: 'user', ts: start, dedupeKey: 'results-it-a' },
      { type: 'exposure', experimentId: experiment.id, phase: 1, arm: 'variantA', unitId: 'user-b', unitType: 'user', ts: start, dedupeKey: 'results-it-b' },
      { type: 'conversion', unitId: 'visitor-cookie', userId: 'user-a', unitType: 'visitor', eventName: 'signup', value: 1,
        ts: new Date(Date.parse(start) + 2 * 3_600_000).toISOString(), dedupeKey: 'results-it-conversion' },
    ])
    expect(await runResults(payload, { experimentId: experiment.id })).toMatchObject({ ran: 1, skipped: 0, processedIds: [experiment.id] })
    const { docs } = await payload.find({ collection: 'xp-results-snapshots', overrideAccess: true, where: { experiment: { equals: experiment.id } } })
    expect(docs).toHaveLength(1)
    const snapshot = docs[0]!.snapshot as import('../src/types/snapshot.js').Snapshot
    expect(snapshot.method).toBe('sequential')
    expect(snapshot.metrics[0]!.name).toBe('Frozen signup')
    expect(snapshot.metrics[0]!.perArm.find(arm => arm.arm === 'control')!.converters).toBe(1)
    expect(snapshot.exposures.total).toBe(2)
  } finally { await harness.teardown() }
}, 60_000)

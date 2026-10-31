import { expect, test } from 'vitest'
import { pooledExecutor } from '../src/db/executor.js'
import { insertEvents } from '../src/db/events.js'
import { createIntegrationHarness } from './harness.js'

test('concurrent event retries insert exactly one dedupe key', async () => {
  const harness = await createIntegrationHarness()
  try {
    const exec = pooledExecutor(harness.payload)
    const row = { type: 'conversion' as const, unitId: 'visitor', unitType: 'visitor' as const, value: 1, dedupeKey: 'conversion:s:concurrent', ts: new Date().toISOString() }
    const counts = await Promise.all(Array.from({ length: 12 }, () => insertEvents(exec, [row])))
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1)
    expect((await exec.query('SELECT count(*)::integer AS count FROM "' + harness.schemaName + '".xp_events')).rows).toEqual([{ count: 1 }])
  } finally { await harness.teardown() }
})

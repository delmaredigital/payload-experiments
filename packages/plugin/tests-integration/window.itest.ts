import { expect, test } from 'vitest'
import { insertEvents, type EventRow } from '../src/db/events.js'
import { pooledExecutor } from '../src/db/executor.js'
import { metricEventRows, phaseExposureRows } from '../src/db/results.js'
import { firstExposures, perUnitValues } from '../src/results/aggregate.js'
import { createIntegrationHarness } from './harness.js'

// Train-only: real Postgres, in the harness's fresh disposable schema.
test('attribution window end and endedAt are half-open, including the exposure cut-off', async () => {
  const harness = await createIntegrationHarness()
  try {
    const experiment = await harness.payload.create({ collection: 'xp-experiments', overrideAccess: true, data: {
      name: 'Window', slug: 'window', kind: 'code', unitType: 'visitor', exposurePolicy: 'manual',
    } })
    const exec = pooledExecutor(harness.payload)
    const start = Date.parse('2026-10-31T00:00:00.123Z')
    const hour = 3_600_000
    const endedAt = start + 2 * hour
    let serial = 0
    const row = (unitId: string, ts: number, overrides: Partial<EventRow> = {}): EventRow => ({
      type: 'exposure', experimentId: experiment.id, phase: 1, arm: 'control', unitId, unitType: 'visitor',
      ts: new Date(ts).toISOString(), dedupeKey: `window-${++serial}`, ...overrides,
    })
    const conversion = (unitId: string, ts: number, value: number) => row(unitId, ts, { type: 'conversion', eventName: 'window', value })
    await insertEvents(exec, [
      row('window-bound', start),
      row('phase-bound', start + hour + 1),
      row('at-end', endedAt), row('after-end', endedAt + 1),
      row('window-bound', endedAt, { arm: 'variantA' }),
      conversion('window-bound', start - 1, 100),
      conversion('window-bound', start, 2),
      conversion('window-bound', start + hour - 1, 3),
      conversion('window-bound', start + hour, 100),
      conversion('phase-bound', endedAt - 1, 7),
      conversion('phase-bound', endedAt, 100),
      conversion('phase-bound', endedAt + 1, 100),
    ])
    const exposures = await phaseExposureRows(exec, { experimentId: experiment.id, phase: 1, endedAt })
    expect(exposures).toEqual([
      { unitId: 'window-bound', arm: 'control', ts: start },
      { unitId: 'phase-bound', arm: 'control', ts: start + hour + 1 },
    ])
    const exposed = firstExposures(exposures, { endedAt })
    expect(exposed.excludedMultiArm).toBe(0)
    const allRows = await phaseExposureRows(exec, { experimentId: experiment.id, phase: 1 })
    expect(firstExposures(allRows, { endedAt })).toEqual(exposed)
    const events = await metricEventRows(exec, { eventName: 'window', from: start - 1, to: endedAt + hour })
    expect([...perUnitValues(exposed.units, events, { kind: 'revenue', windowHours: 1, endedAt })]).toEqual([
      ['window-bound', 5], ['phase-bound', 7],
    ])
    const bounded = await metricEventRows(exec, { eventName: 'window', from: start, to: endedAt })
    expect(bounded.every(event => typeof event.ts === 'number' && event.ts >= start && event.ts < endedAt)).toBe(true)
    expect([...perUnitValues(exposed.units, bounded, { kind: 'revenue', windowHours: 1, endedAt })]).toEqual([
      ['window-bound', 5], ['phase-bound', 7],
    ])
  } finally { await harness.teardown() }
}, 60_000)

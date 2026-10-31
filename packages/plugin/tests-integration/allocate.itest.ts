import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { sampleOptions } from '../tests/collections/fixtures.js'
import { start } from '../src/transitions/start.js'
import { allocate } from '../src/transitions/allocate.js'
import { stop } from '../src/transitions/stop.js'
import { assign } from '../src/runtime/assign.js'
import { pgPoolExecutor } from '../src/db/executor.js'
import { readState } from '../src/db/state.js'

// Train-only: written in CORE-10b; never run against a network DB in the lane.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => { harness = await createIntegrationHarness() }, 60_000)
afterAll(async () => { await harness?.teardown() })

test.each([false, true])('allocate widens assignment without moving enrolled units (layer=%s)', async layered => {
  const { payload } = harness
  const options = sampleOptions()
  const req = await createLocalReq({}, payload)
  const suffix = layered ? 'layer' : 'coverage'
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true,
    data: { name: 'Signups', slug: `allocate-${suffix}`, source: 'binomial', direction: 'increase' } })
  const layer = layered ? await payload.create({ collection: 'xp-layers', req, overrideAccess: true,
    data: { name: 'Allocation', slug: 'allocation-layer', unitType: 'visitor' } }) : null
  const draft = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: 'Allocation', slug: `allocate-${suffix}`, kind: 'code', unitType: 'visitor', allocation: 20,
    exposurePolicy: 'manual', metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
    ...(layer ? { layer: layer.id } : {}),
  } })
  const started = await start(req, { experimentId: draft.id, options })
  const exec = Object.assign(pgPoolExecutor(harness.pool), { schemaName: harness.schemaName })
  const before = (await readState(exec))!.manifest!
  const raised = await allocate(req, { experimentId: draft.id, allocation: 60 })
  const after = (await readState(exec))!.manifest!
  expect(raised.revision).toBe(started.revision + 1)
  expect(raised.doc.seed).toBe(started.doc.seed)
  expect(after.experiments.find(e => e.id === draft.id)!.coverage).toBe(layered ? 1 : 0.6)
  let enrolled = 0
  for (let i = 0; i < 10000; i++) {
    const unit = { visitorId: String(i), consent: true }
    const a = assign(before, unit, {}, { now: Date.now() }).bySlug[`allocate-${suffix}`]!
    if (a.exposable) {
      enrolled++
      expect(assign(after, unit, {}, { now: Date.now() }).bySlug[`allocate-${suffix}`]).toMatchObject({ arm: a.arm, exposable: true })
    }
  }
  expect(enrolled).toBeGreaterThan(1000)
  const phases = await payload.find({ collection: 'xp-phases', req, overrideAccess: true,
    where: { experiment: { equals: draft.id } }, depth: 0 })
  expect(phases.docs[0]!.allocationChanges).toEqual([{ at: expect.any(String), from: 20, to: 60 }])
  if (layered) {
    expect(raised.doc.layerSlices).toHaveLength(60)
    expect(raised.doc.layerSlices).toEqual(expect.arrayContaining(started.doc.layerSlices as number[]))
  }
  const stopped = await stop(req, { experimentId: draft.id })
  expect(stopped.doc.layerSlices).toEqual([])
})

import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { sampleOptions } from '../tests/collections/fixtures.js'
import { start } from '../src/transitions/start.js'
import { stop } from '../src/transitions/stop.js'
import { decide } from '../src/transitions/decide.js'
import { releaseHoldout } from '../src/transitions/releaseHoldout.js'
import { assign } from '../src/runtime/assign.js'
import { pgPoolExecutor } from '../src/db/executor.js'
import { readState } from '../src/db/state.js'

// Train-only: no network database access in the lane.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => { harness = await createIntegrationHarness() }, 60_000)
afterAll(async () => { await harness?.teardown() })

test.each([false, true])('decide preserves holdout membership, frozen config and stopped slices (layer=%s)', async layered => {
  const { payload } = harness
  const options = sampleOptions()
  const req = await createLocalReq({}, payload)
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true,
    data: { name: 'Decide', slug: `decide-${layered}`, source: 'binomial', direction: 'increase' } })
  const layer = layered ? await payload.create({ collection: 'xp-layers', req, overrideAccess: true,
    data: { name: 'Decide', slug: 'decide-layer', unitType: 'visitor' } }) : null
  const draft = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: 'Decide', slug: `decide-${layered}`, kind: 'code', unitType: 'visitor', allocation: 50, exposurePolicy: 'manual',
    arms: [
      { key: 'control', label: 'Original', kind: 'control', weight: 5 },
      { key: 'variantA', label: 'New title', kind: 'variant', weight: 93 },
      { key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 2 },
    ], targeting: [{ attribute: 'country', op: 'eq', value: 'US' }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 }, ...(layer ? { layer: layer.id } : {}),
  } })
  const started = await start(req, { experimentId: draft.id, options })
  const exec = Object.assign(pgPoolExecutor(harness.pool), { schemaName: harness.schemaName })
  const before = (await readState(exec))!.manifest!
  await stop(req, { experimentId: draft.id })
  const phases = await payload.find({ collection: 'xp-phases', req, overrideAccess: true, where: { experiment: { equals: draft.id } } })
  const endedAt = phases.docs[0]!.endedAt
  await payload.update({ collection: 'xp-experiments', id: draft.id, req, overrideAccess: true,
    data: { targeting: [{ attribute: 'age', op: 'gt', value: 20 }] } })
  const decided = await decide(req, { experimentId: draft.id, winnerArm: 'variantA', note: 'Ship', confirmation: 'New title' })
  expect(decided.doc.seed).toBe(started.doc.seed)
  expect(decided.doc.layerSlices).toEqual(started.doc.layerSlices)
  const rounds = await payload.find({ collection: 'xp-phases', req, overrideAccess: true, sort: 'phase', where: { experiment: { equals: draft.id } } })
  expect(rounds.docs[0]!.endedAt).toBe(endedAt)
  expect(rounds.docs[1]).toMatchObject({ phaseKind: 'rollout', seed: started.doc.seed,
    targeting: [{ attribute: 'country', op: 'eq', value: 'US', type: 'string' }] })
  const after = (await readState(exec))!.manifest!
  let holdouts = 0
  for (let i = 0; i < 10000; i++) {
    const unit = { visitorId: String(i), consent: true }
    const a = assign(before, unit, { country: 'US' }, { now: Date.now() }).bySlug[`decide-${layered}`]!
    const b = assign(after, unit, { country: 'US' }, { now: Date.now() }).bySlug[`decide-${layered}`]!
    expect(b.arm === 'holdout').toBe(a.arm === 'holdout')
    if (b.arm === 'holdout') holdouts++
  }
  expect(holdouts).toBeGreaterThan(20)
  const released = await releaseHoldout(req, { experimentId: draft.id })
  expect(released.doc.layerSlices).toEqual([])
  expect(released.doc.decision).toHaveProperty('holdoutReleasedAt')
})

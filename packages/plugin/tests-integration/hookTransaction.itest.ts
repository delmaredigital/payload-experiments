import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Arm, ResolvedOptions } from '../src/types/contracts.js'
import { createIntegrationHarness } from './harness.js'

// Written for the merged-main train. Never run against a network DB in a lane.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => {
  harness = await createIntegrationHarness({ manage: ({ req }) => Boolean(req.user) })
}, 60_000)
afterAll(async () => { await harness?.teardown() })

test('migration creates keep the caller transaction and registered flag control defaults', async () => {
  const { payload } = harness
  const req = await createLocalReq({}, payload)
  const options = payload.config.custom!.xp as ResolvedOptions
  expect(req.user).toBeFalsy()
  expect(await options.access.manage({ req })).toBe(false)
  expect(options.flagPoints).toHaveLength(1)
  const point = options.flagPoints![0]!

  await initTransaction(req)
  const transactionID = req.transactionID
  expect(transactionID).toBeTruthy()
  try {
    // Migrations intentionally bypass top-level access without a user; all three
    // creates must still share the caller's transaction through nested hooks.
    const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true,
      data: { name: 'Hook transaction', slug: 'hook-transaction', source: 'binomial', direction: 'increase' } })
    const block = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
      name: 'Hook block', slug: 'hook-block', kind: 'block', unitType: 'visitor', exposurePolicy: 'render',
      metrics: { primary: metric.id },
      arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' },
        { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' }],
    } })
    const flag = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
      name: 'Hook flag', slug: 'hook-flag', kind: 'flag', flagPoint: point.id, unitType: 'visitor', exposurePolicy: 'manual',
      metrics: { primary: metric.id },
      arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, params: { title: 'Tampered' } },
        { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, params: { title: 'Variant' } }],
    } })
    expect(req.transactionID).toBeTruthy()
    expect(req.transactionID).toBe(transactionID)
    await commitTransaction(req)

    const freshReq = await createLocalReq({}, payload)
    const storedMetric = await payload.findByID({ collection: 'xp-metrics', id: metric.id, req: freshReq, overrideAccess: true, depth: 0 })
    const storedBlock = await payload.findByID({ collection: 'xp-experiments', id: block.id, req: freshReq, overrideAccess: true, depth: 0 })
    const storedFlag = await payload.findByID({ collection: 'xp-experiments', id: flag.id, req: freshReq, overrideAccess: true, depth: 0 })
    expect(storedMetric.id).toBe(metric.id)
    expect(storedBlock.id).toBe(block.id)
    expect(storedFlag.id).toBe(flag.id)
    expect((storedFlag.arms as Arm[]).find(arm => arm.kind === 'control')?.params).toEqual(point.defaultParams)
  } finally {
    if (req.transactionID) await killTransaction(req)
  }
})

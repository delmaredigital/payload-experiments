import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { deleteGuard } from '../src/collections/experiments/deleteGuard.js'
import { pgPoolExecutor } from '../src/db/executor.js'
import { readState } from '../src/db/state.js'
import { withTransition } from '../src/transitions/kernel.js'

// Train-only: deleteByID must roll back the cascade with its request transaction.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => { harness = await createIntegrationHarness() }, 60_000)
afterAll(async () => { await harness?.teardown() })

async function fixture(slug: string) {
  const { payload } = harness
  const req = await createLocalReq({ context: { xpTransition: true } }, payload)
  const arms = [
    { key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' },
    { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' },
  ]
  const draft = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: slug, slug, kind: 'block', unitType: 'visitor', exposurePolicy: 'render', allocation: 100, arms,
  } })
  const experimentId = draft.id
  await payload.create({ collection: 'xp-phases', req, overrideAccess: true, data: {
    experiment: experimentId, phase: 1, phaseKind: 'test', seed: 'test|', startedAt: '2026-10-01T00:00:00.000Z',
    endedAt: '2026-10-02T00:00:00.000Z', arms, allocation: 100, targeting: [],
  } })
  await payload.create({ collection: 'xp-results-snapshots', req, overrideAccess: true, data: {
    experiment: experimentId, phase: 1, computedAt: '2026-10-02T00:00:00.000Z', window: {}, snapshot: {},
  } })
  await payload.create({ collection: 'xp-events', req, overrideAccess: true, data: {
    experiment: experimentId, phase: 1, arm: 'control', type: 'exposure', unitId: slug, unitType: 'visitor',
    ts: '2026-10-01T00:00:00.000Z', dedupeKey: `delete:${slug}`,
  } })
  await withTransition(req, { experimentId }, async () => {
    await payload.update({ collection: 'xp-experiments', id: experimentId, req, overrideAccess: true,
      data: { status: 'archived', phase: 1, decision: { winnerArm: 'variantA' } } })
  })
  const exec = Object.assign(pgPoolExecutor(harness.pool), { schemaName: harness.schemaName })
  return { payload, req, experimentId, exec }
}

test('deleting an archived block removes its archivedWinners routing', async () => {
  const f = await fixture('delete-archived-block')
  expect((await readState(f.exec))!.manifest!.archivedWinners).toHaveProperty('delete-archived-block', 'variantA')
  await f.payload.delete({ collection: 'xp-experiments', id: f.experimentId, req: f.req, overrideAccess: false })
  expect((await readState(f.exec))!.manifest!.archivedWinners).not.toHaveProperty('delete-archived-block')
  for (const collection of ['xp-phases', 'xp-events', 'xp-results-snapshots'] as const) {
    expect((await f.payload.find({ collection, req: f.req, overrideAccess: true, where: { experiment: { equals: f.experimentId } } })).totalDocs).toBe(0)
  }
})

test('a cascade failure in beforeDelete leaves experiment, phases, events and snapshots intact', async () => {
  const f = await fixture('delete-rollback')
  const collection = f.payload.collections['xp-experiments']!.config
  const original = collection.hooks.beforeDelete
  // Fail after the real cascade has executed, while still inside beforeDelete.
  collection.hooks.beforeDelete = [async args => { await deleteGuard(args); throw new Error('injected cascade failure') }]
  const before = await readState(f.exec)
  try {
    await expect(f.payload.delete({ collection: 'xp-experiments', id: f.experimentId, req: f.req, overrideAccess: false })).rejects.toThrow('injected cascade failure')
  } finally { collection.hooks.beforeDelete = original }
  const req = await createLocalReq({}, f.payload)
  expect(await f.payload.findByID({ collection: 'xp-experiments', id: f.experimentId, req, overrideAccess: true })).toMatchObject({ status: 'archived' })
  for (const child of ['xp-phases', 'xp-events', 'xp-results-snapshots'] as const) {
    expect((await f.payload.find({ collection: child, req, overrideAccess: true, where: { experiment: { equals: f.experimentId } } })).totalDocs).toBe(1)
  }
  expect((await readState(f.exec))!.revision).toBe(before!.revision)
})

test('two-id bulk delete concurrent with Start on the second id completes without a lock cycle', async () => {
  const { start } = await import('../src/transitions/start.js')
  const { sampleOptions } = await import('../tests/collections/fixtures.js')
  const { payload } = harness
  const req = await createLocalReq({}, payload)
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true, data: {
    name: 'Bulk Start goal', slug: 'bulk-start-goal', source: 'binomial', direction: 'increase', attributionWindowHours: 24,
  } })
  const drafts = []
  for (const slug of ['bulk-start-first', 'bulk-start-second']) drafts.push(await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: slug, slug, kind: 'code', unitType: 'visitor', exposurePolicy: 'manual', allocation: 100,
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50 }, { key: 'variantA', label: 'Version', kind: 'variant', weight: 50 }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } }))
  const first = drafts[0]!, second = drafts[1]!
  const options = sampleOptions()
  const deleting = await createLocalReq({}, payload), starting = await createLocalReq({}, payload)
  const outcomes = await Promise.allSettled([
    payload.delete({ collection: 'xp-experiments', req: deleting, overrideAccess: false, where: { id: { in: [first.id, second.id] } } }),
    start(starting, { experimentId: second.id, options }),
  ])
  // Either winner is valid: Start may see a deleted row, or Delete may see the newly running test.
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ code: expect.stringMatching(/^(not-found|invalid-status)$/) })
    if (outcome.status === 'fulfilled' && outcome.value && 'errors' in outcome.value) {
      for (const error of outcome.value.errors) expect(error.message).toBe('This action is not available in the current status.')
    }
  }
}, 30_000)

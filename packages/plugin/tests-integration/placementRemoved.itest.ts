import { createLocalReq, type Field } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { createExperimentBlock } from '../src/blocks/createExperimentBlock.js'
import { unwrapExperimentBlock, wrapExperimentBlock } from '../src/blocks/formState.js'
import { start } from '../src/transitions/start.js'
import { stop } from '../src/transitions/stop.js'
import { decide } from '../src/transitions/decide.js'
import { archive } from '../src/transitions/archive.js'
import { pgPoolExecutor } from '../src/db/executor.js'
import { readState } from '../src/db/state.js'
import { READINESS_COPY } from '../src/admin/copy/readiness.js'
import type { DocId, ResolvedOptions } from '../src/types/contracts.js'

// Run with XP_IT_ID_TYPE=serial and uuid (2026-11-07: tests 136-278 ms locally on both).
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let sequence = 0
beforeAll(async () => {
  const blocks = [{ slug: 'text', fields: [{ name: 'text', type: 'text' as const }] }]
  harness = await createIntegrationHarness({
    collections: [{ slug: 'removed-pages', versions: { drafts: true },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'slug', type: 'text' }, { name: 'layout', type: 'blocks', blocks: [...blocks, createExperimentBlock({ blocks })] }],
    }],
    blocks: { collections: [{ slug: 'removed-pages', field: 'layout' }] },
  })
}, 60_000) // Harness bootstrap; the IT harness's usual cap.
afterAll(async () => { await harness?.teardown() }, 60_000)
const request = () => createLocalReq({}, harness.payload)
const options = () => harness.payload.config.custom!.xp as ResolvedOptions
const field = () => harness.payload.config.collections.find(c => c.slug === 'removed-pages')!.fields.find(f => 'name' in f && f.name === 'layout') as Extract<Field, { type: 'blocks' }>
const phases = async (id: DocId) => (await harness.payload.find({ collection: 'xp-phases', req: await request(), overrideAccess: true,
  depth: 0, sort: 'phase', where: { experiment: { equals: id } } })).docs
const current = async (id: DocId) => harness.payload.findByID({ collection: 'xp-experiments', id, req: await request(), overrideAccess: true, depth: 0 })
const revision = async () => (await readState(Object.assign(pgPoolExecutor(harness.pool), { schemaName: harness.schemaName })))!.revision
async function fixture() {
  const { payload } = harness, suffix = ++sequence
  const metric = await payload.create({ collection: 'xp-metrics', req: await request(), overrideAccess: true,
    data: { name: 'Goal', slug: `removed-goal-${suffix}`, source: 'binomial', direction: 'increase' } })
  const experiment = await payload.create({ collection: 'xp-experiments', req: await request(), overrideAccess: true, data: {
    name: 'Removed block', slug: `removed-block-${suffix}`, kind: 'block', unitType: 'visitor', allocation: 100, exposurePolicy: 'render',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 45, slot: 'control' },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 45, slot: 'variantA' },
      { key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 10 }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
  const wrapper = wrapExperimentBlock({ blockType: 'text', text: 'Original' }, String(experiment.slug), field())
  wrapper.slots[1]!.blocks[0]!.text = 'Variant'
  const page = await payload.create({ collection: 'removed-pages', req: await request(), overrideAccess: false,
    data: { slug: `removed-page-${suffix}`, layout: [wrapper], _status: 'published' } })
  await start(await request(), { experimentId: experiment.id, options: options() })
  await stop(await request(), { experimentId: experiment.id })
  return { experiment, page }
}

test('unwrapped stopped block refuses Start and either winner, keeps its round, and can archive', async () => {
  const { experiment, page } = await fixture()
  const wrapper = page.layout[0]
  await harness.payload.update({ collection: 'removed-pages', id: page.id, req: await request(), overrideAccess: false,
    data: { layout: unwrapExperimentBlock(wrapper, field()), _status: 'published' } })
  const before = await current(experiment.id), rounds = await phases(experiment.id), stateRevision = await revision()
  expect(before).toMatchObject({ status: 'stopped', phase: 1 })
  expect(rounds).toHaveLength(1)
  await expect(start(await request(), { experimentId: experiment.id, options: options() }))
    .rejects.toMatchObject({ code: 'placement-removed', status: 422, message: READINESS_COPY.placementRemoved })
  expect(await current(experiment.id)).toMatchObject({ status: 'stopped', phase: before.phase })
  expect(await revision()).toBe(stateRevision)
  for (const winnerArm of ['control', 'variantA']) {
    const req = await request()
    await expect(decide(req, { experimentId: experiment.id, winnerArm, note: 'Choose winner', confirmation: winnerArm === 'control' ? 'Original' : 'Variant A' }))
      .rejects.toMatchObject({ code: 'placement-removed', status: 422, message: READINESS_COPY.placementRemoved })
    expect(req.transactionID).toBeUndefined()
    expect(await current(experiment.id)).toMatchObject({ status: 'stopped', phase: before.phase })
    expect(await phases(experiment.id)).toEqual(rounds)
    expect(await revision()).toBe(stateRevision)
  }
  const archived = await archive(await request(), { experimentId: experiment.id, mode: 'stopped' })
  expect(archived.doc).toMatchObject({ status: 'archived', phase: before.phase })
  expect(await phases(experiment.id)).toEqual(rounds)
}, 30_000) // Measured 278 ms serial, 255 ms uuid; cap exceeds 3×.

test.each(['control', 'variantA'])('still-wrapped stopped block can decide %s', async winnerArm => {
  const { experiment } = await fixture()
  const decided = await decide(await request(), { experimentId: experiment.id, winnerArm,
    note: 'Choose winner', confirmation: winnerArm === 'control' ? 'Original' : 'Variant A' })
  expect(decided.doc).toMatchObject({ status: 'decided', decision: { winnerArm } })
  expect(await phases(experiment.id)).toHaveLength(winnerArm === 'control' ? 1 : 2)
}, 30_000) // Measured max 168 ms (serial/uuid); cap exceeds 3×.

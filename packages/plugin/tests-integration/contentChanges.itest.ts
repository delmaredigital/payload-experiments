import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { start } from '../src/transitions/start.js'
import type { ResolvedOptions } from '../src/types/contracts.js'

// Written for the merged-main train. Never run against a network DB in a lane.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => {
  harness = await createIntegrationHarness({
    collections: [{ slug: 'audit-pages', versions: { drafts: { autosave: true }, maxPerDoc: 2 },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'title', type: 'text' }, { name: 'content', type: 'json' }],
    }], puckCollections: [{ slug: 'audit-pages', field: 'content' }],
  })
}, 60_000)
afterAll(async () => { await harness?.teardown() })

async function setup(name: string) {
  const { payload } = harness
  const req = await createLocalReq({}, payload)
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true,
    data: { name, slug: name, source: 'binomial', direction: 'increase' } })
  const experiment = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name, slug: name, kind: 'block', unitType: 'visitor', allocation: 100, exposurePolicy: 'render',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
  const content = (value: string) => ({ content: [{ type: 'ExperimentSlot', props: {
    id: 'slot', experiment: { id: String(experiment.id), slug: name },
    control: [{ type: 'Text', props: { text: value } }], variantA: [{ type: 'Text', props: { text: 'Variant' } }],
  } }] })
  const page = await payload.create({ collection: 'audit-pages', req, overrideAccess: false,
    data: { title: name, content: content('Published'), _status: 'published' } })
  await start(req, { experimentId: experiment.id, options: payload.config.custom!.xp as ResolvedOptions })
  const save = (value: string, draft: boolean, autosave = false) => payload.update({ collection: 'audit-pages', id: page.id,
    req, overrideAccess: false, draft, autosave, data: { content: content(value), _status: draft ? 'draft' : 'published' } })
  const markers = async () => {
    const phases = await payload.find({ collection: 'xp-phases', req, overrideAccess: true,
      where: { and: [{ experiment: { equals: experiment.id } }, { phase: { equals: 1 } }] } })
    return phases.docs[0]!.contentChanges as unknown[]
  }
  return { payload, req, page, save, markers }
}

test('autosave then publish records exactly one marker against the main published row', async () => {
  const f = await setup('audit-autosave')
  await f.save('Edited', true, true)
  expect(await f.markers()).toHaveLength(0)
  await f.save('Edited', false)
  expect(await f.markers()).toHaveLength(1)
})
test('maxPerDoc 2, five drafts, then unchanged publish records no marker', async () => {
  const f = await setup('audit-pruning')
  for (let i = 0; i < 5; i++) await f.save(`Draft ${i}`, true)
  const versions = await f.payload.findVersions({ collection: 'audit-pages', req: f.req, overrideAccess: false,
    where: { parent: { equals: f.page.id } }, limit: 0 })
  expect(versions.totalDocs).toBeLessThanOrEqual(2)
  await f.save('Published', false)
  expect(await f.markers()).toHaveLength(0)
})
test('unpublish then republish unchanged records no marker', async () => {
  const f = await setup('audit-republish')
  await f.payload.update({ collection: 'audit-pages', id: f.page.id, req: f.req, overrideAccess: false,
    draft: false, data: { _status: 'draft' } })
  expect(await f.markers()).toHaveLength(0)
  await f.save('Published', false)
  expect(await f.markers()).toHaveLength(0)
})

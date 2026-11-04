import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { start } from '../src/transitions/start.js'
import type { ResolvedOptions } from '../src/types/contracts.js'

// Train only, serial and uuid ids. This lane never runs network database tests.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => {
  harness = await createIntegrationHarness({ collections: [{ slug: 'binding-pages', versions: { drafts: true },
    access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
    fields: [{ name: 'title', type: 'text' }, { name: 'path', type: 'text' }, { name: 'layout', type: 'json' }],
  }], pages: { collections: [{ slug: 'binding-pages', pathOf: doc => typeof doc.path === 'string' ? doc.path : null, contentOf: doc => doc.layout,
    findByPath: async (path, req) => {
      const result = await req.payload.find({ collection: 'binding-pages', req, overrideAccess: false, depth: 0, limit: 1,
        where: { and: [{ path: { equals: path } }, { _status: { equals: 'published' } }] } })
      return result.docs[0] ? { id: result.docs[0].id, published: true } : null
    } }] } })
}, 60_000)
afterAll(async () => { await harness?.teardown() })
test('editing the Original records a marker from the current round; an unrelated page does not', async () => {
  const { payload } = harness
  const req = await createLocalReq({}, payload)
  const create = (path: string) => payload.create({ collection: 'binding-pages', req, overrideAccess: false,
    data: { path, title: path, layout: [{ text: path }], _status: 'published' } })
  const original = await create('/original'), variant = await create('/variant'), unrelated = await create('/unrelated')
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true,
    data: { name: 'Binding goal', slug: 'binding-goal', source: 'binomial', direction: 'increase' } })
  const experiment = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: 'Page bindings', slug: 'page-bindings', kind: 'page', pageCollection: 'binding-pages', unitType: 'visitor', exposurePolicy: 'pageview', allocation: 100,
    arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/original' }, { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, pageTarget: '/variant' }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14 },
  } })
  await start(req, { experimentId: experiment.id, options: payload.config.custom!.xp as ResolvedOptions })
  const markers = async () => (await payload.find({ collection: 'xp-phases', req, overrideAccess: true,
    where: { experiment: { equals: experiment.id } }, depth: 0 })).docs[0]!.contentChanges as unknown[]
  await payload.update({ collection: 'binding-pages', id: unrelated.id, req, overrideAccess: false, data: { layout: [{ text: 'Unrelated edit' }] } })
  expect(await markers()).toHaveLength(0)
  await payload.update({ collection: 'binding-pages', id: original.id, req, overrideAccess: false, data: { layout: [{ text: 'Original edit' }] } })
  expect(await markers()).toEqual([expect.objectContaining({ doc: { collection: 'binding-pages', id: original.id } })])
  expect(variant.id).toBeDefined()
})

import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { start } from '../src/transitions/start.js'
import { hiddenBlockPlacementCopy } from '../src/testSurface/copy/readiness.js'
import type { ResolvedOptions } from '../src/types/contracts.js'

let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let sequence = 0
beforeAll(async () => {
  harness = await createIntegrationHarness({
    collections: [{ slug: 'hidden-pages', versions: { drafts: true },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'slug', type: 'text' }, { name: 'puckData', type: 'json' }],
    }], puckCollections: ['hidden-pages'],
  })
}, 60_000)
afterAll(async () => { await harness?.teardown() }, 60_000)
const request = () => createLocalReq({}, harness.payload)
const options = () => harness.payload.config.custom!.xp as ResolvedOptions
async function fixture() {
  const { payload } = harness, suffix = ++sequence
  const metric = await payload.create({ collection: 'xp-metrics', req: await request(), overrideAccess: true,
    data: { name: 'Goal', slug: `hidden-goal-${suffix}`, source: 'binomial', direction: 'increase' } })
  const experiment = await payload.create({ collection: 'xp-experiments', req: await request(), overrideAccess: true, data: {
    name: `Hidden test ${suffix}`, slug: `hidden-test-${suffix}`, kind: 'block', unitType: 'visitor', allocation: 100, exposurePolicy: 'render',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
  const block = { type: 'ExperimentSlot', props: { id: `block-${suffix}`, experiment: { id: experiment.id, slug: experiment.slug },
    control: [{ type: 'Text', props: { id: `original-${suffix}`, text: 'Original' } }],
    variantA: [{ type: 'Text', props: { id: `variant-${suffix}`, text: 'Variant' } }],
  } }
  const content = { root: { props: {} }, content: [block] }
  const page = await payload.create({ collection: 'hidden-pages', req: await request(), overrideAccess: false,
    data: { slug: `hidden-page-${suffix}`, puckData: content, _status: 'published' } })
  await start(await request(), { experimentId: experiment.id, options: options() })
  return { experiment, block, page }
}

test.each(['self', 'slot', 'zone', 'sizes'] as const)('publishing a hidden %s refuses the running test’s last place and preserves publication', async mode => {
  const { experiment, block, page } = await fixture()
  const hidden = { ...block, props: { ...block.props, _visibility: { hidden: true } } }
  const data = { root: { props: {} }, content: mode === 'self' ? [hidden] : mode === 'sizes'
    ? [{ ...block, props: { ...block.props, _visibility: { hideOn: ['phone', 'tablet', 'desktop'] } } }]
    : [{ type: 'Container', props: { id: 'parent', _visibility: { hidden: true }, ...(mode === 'slot' ? { children: [block] } : {}) } }],
    ...(mode === 'zone' ? { zones: { 'parent:children': [block] } } : {}),
  }
  await expect(harness.payload.update({ collection: 'hidden-pages', id: page.id, req: await request(), overrideAccess: false,
    data: { puckData: data, _status: 'published' } })).rejects.toMatchObject({ code: 'locked-placement', status: 409, message: hiddenBlockPlacementCopy(experiment.name) })
  const stored = await harness.payload.findByID({ collection: 'hidden-pages', id: page.id, req: await request(), overrideAccess: false, draft: false })
  expect(stored.puckData.content).toEqual([block])
}, 30_000)

test('hiding in a draft is allowed while the published placement remains', async () => {
  const { block, page } = await fixture()
  await harness.payload.update({ collection: 'hidden-pages', id: page.id, req: await request(), overrideAccess: false, draft: true,
    data: { puckData: { root: { props: {} }, content: [{ ...block, props: { ...block.props, _visibility: { hidden: true } } }] }, _status: 'draft' } })
  const published = await harness.payload.findByID({ collection: 'hidden-pages', id: page.id, req: await request(), overrideAccess: false, draft: false })
  expect(published.puckData.content).toEqual([block])
}, 30_000)

test('hiding a non-last published place and hiding on only some sizes are allowed', async () => {
  const { block, page } = await fixture()
  await harness.payload.update({ collection: 'hidden-pages', id: page.id, req: await request(), overrideAccess: false,
    data: { puckData: { root: { props: {} }, content: [{ ...block, props: { ...block.props, _visibility: { hideOn: ['phone', 'tablet'] } } }] }, _status: 'published' } })
  await harness.payload.create({ collection: 'hidden-pages', req: await request(), overrideAccess: false,
    data: { slug: `other-hidden-place-${sequence}`, puckData: { root: { props: {} }, content: [block] }, _status: 'published' } })
  const saved = await harness.payload.update({ collection: 'hidden-pages', id: page.id, req: await request(), overrideAccess: false,
    data: { puckData: { root: { props: {} }, content: [{ ...block, props: { ...block.props, _visibility: { hidden: true } } }] }, _status: 'published' } })
  expect(saved.puckData.content[0].props._visibility).toEqual({ hidden: true })
}, 30_000)

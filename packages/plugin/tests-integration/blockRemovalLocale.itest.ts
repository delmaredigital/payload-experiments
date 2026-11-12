import { createLocalReq, type CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { scanBlockPlacements } from '../src/transitions/placements.js'
import { createExperimentBlock } from '../src/blocks/createExperimentBlock.js'
import { start } from '../src/transitions/start.js'
import type { ResolvedOptions } from '../src/types/contracts.js'

// Train only; estimate <3 s of test work plus bootstrap, per id mode.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let sequence = 0
beforeAll(async () => {
  harness = await createIntegrationHarness({
    localization: { locales: ['en', 'fr'], defaultLocale: 'en', fallback: true },
    puckCollections: ['locale-puck'], blocks: { collections: [{ slug: 'locale-blocks', field: 'layout' }] },
    collections: ([
      { slug: 'locale-puck', trash: true, versions: { drafts: true }, fields: [{ name: 'puckData', type: 'json', localized: true }] },
      { slug: 'locale-blocks', trash: true, versions: { drafts: true }, fields: [{ name: 'layout', type: 'blocks', localized: true,
        blocks: [{ slug: 'text', fields: [{ name: 'text', type: 'text' }] },
          createExperimentBlock({ blocks: [{ slug: 'text', fields: [{ name: 'text', type: 'text' }] }] })] }] },
    ] satisfies CollectionConfig[]).map(collection => ({ ...collection, access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true } })),
  })
}, 60_000)
afterAll(async () => { await harness?.teardown() }, 60_000)
const request = (locale: string) => createLocalReq({ locale, fallbackLocale: 'null' }, harness.payload)
const options = () => harness.payload.config.custom!.xp as ResolvedOptions

test.each(['puck', 'blocks'] as const)('localized %s removal counts precisely the locale view scanned by Start', async editor => {
  const suffix = ++sequence, { payload } = harness, collection = `locale-${editor}`
  const req = await request('fr')
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true,
    data: { name: 'Goal', slug: `locale-goal-${suffix}`, source: 'binomial', direction: 'increase' } })
  const experiment = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: 'Localized placement', slug: `locale-test-${suffix}`, kind: 'block', unitType: 'visitor', allocation: 100, exposurePolicy: 'render',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
  const content = editor === 'puck' ? { puckData: { content: [{ type: 'ExperimentSlot', props: { experiment: experiment.slug,
    control: [{ type: 'Text', props: { text: 'Original' } }], variantA: [{ type: 'Text', props: { text: 'Variant' } }] } }] } }
    : { layout: [{ blockType: 'xpExperiment', experiment: experiment.slug, slots: [
      { slot: 'control', blocks: [{ blockType: 'text', text: 'Original' }] },
      { slot: 'variantA', blocks: [{ blockType: 'text', text: 'Variant' }] },
    ] }] }
  const empty = editor === 'puck' ? { puckData: { content: [] } } : { layout: [] }
  const page = await payload.create({ collection, req, locale: 'fr', overrideAccess: false, data: { ...content, _status: 'published' } })
  await payload.update({ collection, id: page.id, req: await request('en'), locale: 'en', overrideAccess: false, data: { ...empty, _status: 'published' } })
  const scan = (locale: string) => request(locale).then(req => scanBlockPlacements(req, { slug: String(experiment.slug),
    puckCollections: options().puck!.collections, blocksCollections: options().blocks!.collections }))
  expect(await scan('en')).toEqual([])
  expect(await scan('fr')).toEqual([expect.objectContaining({ id: page.id, published: true, localized: true })])
  await start(await request('fr'), { experimentId: experiment.id, options: options() })
  for (const operation of ['delete', 'unpublish', 'trash']) {
    const work = operation === 'delete' ? payload.delete({ collection, id: page.id, req: await request('en'), overrideAccess: false })
      : payload.update({ collection, id: page.id, req: await request('en'), overrideAccess: false, data: operation === 'unpublish' ? { _status: 'draft' } : { deletedAt: new Date().toISOString() } })
    await expect(work).rejects.toMatchObject({ code: 'locked-placement', message: expect.stringContaining('in this language (fr)') })
  }
  await expect(payload.update({ collection, id: page.id, req: await request('fr'), locale: 'fr', overrideAccess: false,
    data: { ...empty, _status: 'published' } })).rejects.toMatchObject({ code: 'locked-placement', message: expect.stringContaining('only published place') })
}, 30_000) // Estimate <1.5 s each; no measured claim until coordinator runs it.

import { createLocalReq, type CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { contentChangesBeforeHook, contentChangesHook } from '../src/hooks/contentChanges.js'
import { start } from '../src/transitions/start.js'
import type { ResolvedOptions } from '../src/types/contracts.js'

// Written for the merged-main train. Never run against a network DB in a lane.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
const linkedFields: CollectionConfig['fields'] = [{ name: 'layout', type: 'blocks', blocks: [{ slug: 'linked', fields: [
  { name: 'experimentArm', type: 'group', fields: [{ name: 'experiment', type: 'text' }, { name: 'arm', type: 'text' }] },
  { name: 'text', type: 'text' }, { name: 'image', type: 'upload', relationTo: 'audit-media' },
  { name: 'link', type: 'relationship', relationTo: 'audit-links' },
] }] }]
beforeAll(async () => {
  harness = await createIntegrationHarness({
    collections: [{ slug: 'audit-media', upload: { disableLocalStorage: true, filesRequiredOnCreate: false }, access: { read: () => true }, fields: [] },
      // Publicly readable, like a host's media and linked pages, so default-depth reads populate them.
      { slug: 'audit-links', access: { read: () => true }, fields: [{ name: 'title', type: 'text' }] },
      { slug: 'linked-audit-pages', versions: { drafts: true },
        access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
        hooks: { beforeChange: [contentChangesBeforeHook], afterChange: [contentChangesHook] },
        fields: structuredClone(linkedFields),
      }, { slug: 'linked-audit-asks',
        access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
        hooks: { beforeChange: [contentChangesBeforeHook], afterChange: [contentChangesHook] },
        fields: structuredClone(linkedFields),
      }, { slug: 'audit-pages', versions: { drafts: { autosave: true }, maxPerDoc: 2 },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'title', type: 'text' }, { name: 'content', type: 'json' }],
    }], puckCollections: [{ slug: 'audit-pages', field: 'content' }],
  })
}, 60_000)
afterAll(async () => { await harness?.teardown() })

async function setup(name: string, initialDraft = false, startNow = true) {
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
    draft: initialDraft, data: { title: name, content: content('Published'), _status: initialDraft ? 'draft' : 'published' } })
  const begin = () => start(req, { experimentId: experiment.id, options: payload.config.custom!.xp as ResolvedOptions })
  if (startNow) await begin()
  const save = (value: string, draft: boolean, autosave = false) => payload.update({ collection: 'audit-pages', id: page.id,
    req, overrideAccess: false, draft, autosave, data: { content: content(value), _status: draft ? 'draft' : 'published' } })
  const markers = async () => {
    const phases = await payload.find({ collection: 'xp-phases', req, overrideAccess: true,
      where: { and: [{ experiment: { equals: experiment.id } }, { phase: { equals: 1 } }] } })
    return phases.docs[0]!.contentChanges as unknown[]
  }
  return { payload, req, page, save, markers, experiment, begin }
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

test('first publish of unchanged slots created in a draft records one marker', async () => {
  const f = await setup('audit-first-publish', true)
  expect(await f.markers()).toHaveLength(0)
  await f.save('Published', false)
  expect(await f.markers()).toHaveLength(1)
})


test.each(['image', 'link'] as const)('default-depth unchanged %s publish records nothing; a stored content edit records one', async field => {
  const f = await setup(`audit-expanded-${field}`, false, false)
  const linked = await f.payload.create({ collection: field === 'image' ? 'audit-media' : 'audit-links',
    req: f.req, overrideAccess: true, data: { title: 'Linked document', filename: 'linked.png', mimeType: 'image/png' } })
  const page = await f.payload.create({ collection: 'linked-audit-pages', req: f.req, overrideAccess: false,
    data: { _status: 'published', layout: [{ blockType: 'linked', text: 'Original', [field]: linked.id,
      experimentArm: { experiment: String(f.experiment.id), arm: 'variantA' } }] } })
  await f.begin()
  // An API publish that expands links (Payload's default depth outside the admin): explicit, so the harness config can't hide it.
  const unchanged = await f.payload.update({ collection: 'linked-audit-pages', id: page.id, req: f.req,
    overrideAccess: false, depth: 2, data: { _status: 'published' } })
  expect(unchanged.layout[0][field]).toMatchObject({ id: linked.id })
  expect(await f.markers()).toHaveLength(0)
  await f.payload.update({ collection: 'linked-audit-pages', id: page.id, req: f.req, overrideAccess: false, depth: 2,
    data: { _status: 'published', layout: [{ ...unchanged.layout[0], text: 'Changed', [field]: linked.id }] } })
  expect(await f.markers()).toHaveLength(1)
  await f.payload.update({ collection: 'linked-audit-pages', id: page.id, req: f.req, overrideAccess: false,
    depth: 0, data: { _status: 'published' } })
  expect(await f.markers()).toHaveLength(1)
})

test('collection without drafts: depth-2 unchanged upload and relationship write records nothing; a content edit records one', async () => {
  const f = await setup('audit-expanded-no-drafts', false, false)
  const image = await f.payload.create({ collection: 'audit-media', req: f.req, overrideAccess: true,
    data: { filename: 'no-drafts.png', mimeType: 'image/png' } })
  const link = await f.payload.create({ collection: 'audit-links', req: f.req, overrideAccess: true,
    data: { title: 'Linked document' } })
  const page = await f.payload.create({ collection: 'linked-audit-asks', req: f.req, overrideAccess: false,
    data: { layout: [{ blockType: 'linked', text: 'Original', image: image.id, link: link.id,
      experimentArm: { experiment: String(f.experiment.id), arm: 'variantA' } }] } })
  await f.begin()
  const unchanged = await f.payload.update({ collection: 'linked-audit-asks', id: page.id, req: f.req,
    overrideAccess: false, depth: 2, data: {} })
  expect(unchanged.layout[0].image).toMatchObject({ id: image.id })
  expect(unchanged.layout[0].link).toMatchObject({ id: link.id })
  expect(await f.markers()).toHaveLength(0)
  await f.payload.update({ collection: 'linked-audit-asks', id: page.id, req: f.req, overrideAccess: false, depth: 2,
    data: { layout: [{ ...unchanged.layout[0], text: 'Changed', image: image.id, link: link.id }] } })
  expect(await f.markers()).toHaveLength(1)
})

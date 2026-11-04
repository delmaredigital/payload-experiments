import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { start } from '../src/transitions/start.js'
import { stop } from '../src/transitions/stop.js'
import { decide } from '../src/transitions/decide.js'
import { makeContent } from '../src/transitions/makeContent.js'
import type { ResolvedOptions } from '../src/types/contracts.js'

// Train-only: run on serial and uuid. No network database access in this lane.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => {
  harness = await createIntegrationHarness({
    collections: [{ slug: 'publish-pages', versions: { drafts: true },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'title', type: 'text' }, { name: 'secret', type: 'text', hidden: true },
        { name: 'restricted', type: 'text', access: { read: () => false, update: () => true } },
        { name: 'link', type: 'relationship', relationTo: ['publish-pages', 'xp-experiments'] },
        { name: 'content', type: 'json' }],
    }], puckCollections: [{ slug: 'publish-pages', field: 'content' }],
  })
}, 60_000)
afterAll(async () => { await harness?.teardown() })

test('make-content publishes exactly the old main row plus the winning slot, never unrelated draft values', async () => {
  const { payload } = harness
  const req = await createLocalReq({}, payload)
  const options = payload.config.custom!.xp as ResolvedOptions
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true,
    data: { name: 'Publish goal', slug: 'publish-goal', source: 'binomial', direction: 'increase' } })
  const experiment = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: 'Publish', slug: 'publish-main', kind: 'block', unitType: 'visitor', allocation: 100, exposurePolicy: 'render',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
  const winner = { type: 'Text', props: { text: 'Winner' } }
  const content = { content: [{ type: 'ExperimentSlot', props: {
    id: 'slot', experiment: { id: String(experiment.id), slug: 'publish-main' },
    control: [{ type: 'Text', props: { text: 'Original' } }], variantA: [winner],
  } }] }
  const page = await payload.create({ collection: 'publish-pages', req, overrideAccess: false, draft: false,
    data: { title: 'Published title', secret: 'Published hidden', restricted: 'Published restricted', content, _status: 'published' } })
  const readMain = () => payload.db.findOne<Record<string, unknown> & { id: string | number }>({ collection: 'publish-pages', req, where: { id: { equals: page.id } } })
  const before = await readMain()
  await payload.update({ collection: 'publish-pages', id: page.id, req, overrideAccess: false, draft: true,
    data: { title: 'Draft-only title', secret: 'Draft-only hidden', restricted: 'Draft-only restricted', link: { relationTo: 'xp-experiments', value: experiment.id }, _status: 'draft' } })
  const readDraft = async () => {
    const { docs } = await payload.db.findVersions({ collection: 'publish-pages', req, limit: 1, pagination: false,
      where: { and: [{ parent: { equals: page.id } }, { latest: { equals: true } }] }, sort: '-updatedAt' })
    return docs[0]!.version
  }
  const beforeDraft = await readDraft()
  await start(req, { experimentId: experiment.id, options })
  await stop(req, { experimentId: experiment.id })
  await decide(req, { experimentId: experiment.id, winnerArm: 'variantA', note: 'Ship', confirmation: 'Variant A' })
  const result = await makeContent(req, { experimentId: experiment.id, options })
  expect(result.docs).toEqual([{ collection: 'publish-pages', id: page.id, ok: true }])
  const after = await readMain()
  const withoutTimestamp = (doc: Record<string, unknown> | null) => {
    const { updatedAt: _updatedAt, ...rest } = doc!
    return rest
  }
  expect(withoutTimestamp(after)).toEqual({ ...withoutTimestamp(before), content: { content: [winner] } })
  const draft = await payload.findByID({ collection: 'publish-pages', id: page.id, req, overrideAccess: false, draft: true, showHiddenFields: true })
  expect(draft).toMatchObject({ title: 'Draft-only title', secret: 'Draft-only hidden', content: { content: [winner] } })
  const restoredDraft = await readDraft()
  expect(withoutTimestamp(restoredDraft)).toEqual({ ...withoutTimestamp(beforeDraft), content: { content: [winner] } })
})

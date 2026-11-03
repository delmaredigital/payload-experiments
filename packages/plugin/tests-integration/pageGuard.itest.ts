import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { start } from '../src/transitions/start.js'
import { decide } from '../src/transitions/decide.js'
import { archive } from '../src/transitions/archive.js'
import { expectedConfirm } from '../src/transitions/confirmPhrases.js'
import type { ResolvedOptions } from '../src/types/contracts.js'

// Train only: exp-core runs this against serial and uuid Postgres adapters.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => {
  harness = await createIntegrationHarness({
    collections: [{ slug: 'pages', versions: { drafts: { autosave: true } },
      access: { create: () => true, read: () => true, update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [{ name: 'slug', type: 'text', required: true }, { name: 'title', type: 'text' }],
    }],
    pages: { collections: [{ slug: 'pages', pathOf: doc => typeof doc.slug === 'string' ? `/${doc.slug}` : null,
      findByPath: async (path, req) => {
        const pages = await req.payload.find({ collection: 'pages', req, overrideAccess: false, draft: false,
          where: { and: [{ slug: { equals: path.slice(1) } }, { _status: { equals: 'published' } }] } })
        return pages.docs[0] ? { id: pages.docs[0].id, published: true } : null
      },
    }] },
  })
}, 60_000)
afterAll(async () => { await harness?.teardown() })

test('real host saves refuse delete, publishing rename, and unpublish, then protect the archived winner and Original', async () => {
  const { payload } = harness
  const req = await createLocalReq({}, payload)
  const original = await payload.create({ collection: 'pages', req, overrideAccess: false, data: { slug: 'original', _status: 'published' } })
  const winner = await payload.create({ collection: 'pages', req, overrideAccess: false, data: { slug: 'winner', _status: 'published' } })
  const unrelated = await payload.create({ collection: 'pages', req, overrideAccess: false, data: { slug: 'unrelated', _status: 'published' } })
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true, data: { name: 'Goal', slug: 'goal', source: 'binomial', direction: 'increase' } })
  const testDoc = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: 'Better page', slug: 'better-page', kind: 'page', unitType: 'visitor', allocation: 100, exposurePolicy: 'pageview',
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, pageTarget: '/original' },
      { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, pageTarget: '/winner' }],
    metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
  } })
  await start(req, { experimentId: testDoc.id, options: payload.config.custom!.xp as ResolvedOptions })
  for (const page of [original, winner]) {
    await expect(payload.delete({ collection: 'pages', id: page.id, req, overrideAccess: false })).rejects.toMatchObject({ status: 409 })
    await expect(payload.update({ collection: 'pages', id: page.id, req, overrideAccess: false, draft: false,
      data: { slug: 'renamed', _status: 'published' } })).rejects.toMatchObject({ status: 409 })
    await expect(payload.update({ collection: 'pages', id: page.id, req, overrideAccess: false, draft: false,
      data: { _status: 'draft' } })).rejects.toMatchObject({ status: 409 })
  }
  await payload.update({ collection: 'pages', id: original.id, req, overrideAccess: false, draft: true, data: { slug: 'draft-rename', _status: 'draft' } })
  await expect(payload.update({ collection: 'pages', id: original.id, req, overrideAccess: false, draft: false,
    data: { slug: 'draft-rename', _status: 'published' } })).rejects.toMatchObject({ status: 409 })
  await payload.delete({ collection: 'pages', id: unrelated.id, req, overrideAccess: false })
  await decide(req, { experimentId: testDoc.id, winnerArm: 'variantA', note: 'Owner choice', confirmation: expectedConfirm('decide', 'Variant A') })
  // Page content report is the existing archive-after-content transition contract.
  await payload.update({ collection: 'xp-experiments', id: testDoc.id, req, overrideAccess: true,
    context: { xpTransition: true }, data: { decision: { winnerArm: 'variantA', contentReport: { docs: [{ ok: true }] } } } })
  await archive(req, { experimentId: testDoc.id, mode: 'after-content' })
  for (const page of [winner, original]) await expect(payload.delete({ collection: 'pages', id: page.id, req, overrideAccess: false })).rejects.toMatchObject({ status: 409 })
})

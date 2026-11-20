import { createLocalReq, type CollectionConfig, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { buildEndpoints } from '../src/endpoints/index.js'
import { createExperimentBlock } from '../src/blocks/createExperimentBlock.js'
import { withTransition } from '../src/transitions/kernel.js'
import type { ResolvedOptions } from '../src/types/contracts.js'

// Coordinator only: real localized Local API reads, for serial and uuid trains.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
let sequence = 0
let manager: NonNullable<PayloadRequest['user']>
beforeAll(async () => {
  harness = await createIntegrationHarness({
    localization: { defaultLocale: 'en', fallback: true, locales: [
      { code: 'en', label: { en: 'English', fr: 'Anglais' } },
      { code: 'fr', label: { en: 'French', fr: 'Français' } },
    ] },
    puckCollections: ['impact-pages'],
    blocks: { collections: [{ slug: 'impact-pages', field: 'layout', appliesTo: doc => {
      // Every caller must supply the same per-locale shape as a normal Local API read.
      expect(typeof doc.editor).toBe('string')
      expect(typeof doc.title).toBe('string')
      return doc.editor === 'blocks'
    } }] },
    pages: { collections: [{ slug: 'impact-pages', pathOf: doc => `/site/${doc.slug}`, findByPath: async () => null }] },
    collections: [{ slug: 'impact-pages', admin: { useAsTitle: 'title' }, versions: { drafts: true },
      access: { create: () => true, read: () => ({ visible: { equals: true } }), update: () => true, delete: () => true, readVersions: () => true, unlock: () => true },
      fields: [
        { name: 'title', type: 'text', localized: true }, { name: 'slug', type: 'text', localized: true },
        { name: 'editor', type: 'text', localized: true }, { name: 'visible', type: 'checkbox' },
        { name: 'puckData', type: 'json', localized: true }, { name: 'layout', type: 'blocks', localized: true, blocks: [
          { slug: 'text', fields: [{ name: 'text', type: 'text' }] },
          createExperimentBlock({ blocks: [{ slug: 'text', fields: [{ name: 'text', type: 'text' }] }] }),
        ] },
      ],
    } satisfies CollectionConfig],
  })
  const user = await harness.payload.create({ collection: 'users', overrideAccess: true, data: { email: 'impact-manager@example.test', password: 'integration-only-password' } })
  manager = { ...user, collection: 'users' }
}, 60_000)
afterAll(async () => { await harness?.teardown() }, 60_000)

async function request(locale: string): Promise<PayloadRequest> {
  return createLocalReq({ locale, user: manager }, harness.payload)
}

test.each(['puck', 'blocks'] as const)('delete impact for localized %s uses manager metadata and counts affected fallback visitors once per page', async editor => {
  const { payload } = harness, suffix = ++sequence
  const req = await request('en')
  const arms = [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, slot: 'control' },
    { key: 'variantA', kind: 'variant', label: 'Winner', weight: 50, slot: 'variantA' },
  ]
  const experiment = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: 'Localized delete impact', slug: `localized-impact-${suffix}`, kind: 'block', unitType: 'visitor', exposurePolicy: 'render', allocation: 100, arms,
  } })
  await payload.create({ collection: 'xp-phases', req, overrideAccess: true, data: {
    experiment: experiment.id, phase: 1, phaseKind: 'test', seed: 'impact|', allocation: 100, targeting: [], arms,
    startedAt: '2026-10-01T00:00:00.000Z', endedAt: '2026-10-02T00:00:00.000Z',
  } })
  // Seed a completed decision without changing page content, as delete.itest does.
  await withTransition(req, { experimentId: experiment.id }, async ({ req }) => {
    await payload.update({ collection: 'xp-experiments', id: experiment.id, req, overrideAccess: true,
      data: { status: 'archived', phase: 1, decision: { winnerArm: 'variantA' } } })
  })
  const content = editor === 'puck' ? { puckData: { content: Array.from({ length: 2 }, () => ({ type: 'ExperimentSlot', props: {
    experiment: { id: experiment.id, slug: experiment.slug }, control: [{ type: 'Text', props: { text: 'Original' } }], variantA: [{ type: 'Text', props: { text: 'Winner' } }],
  } })) } } : { layout: Array.from({ length: 2 }, () => ({ blockType: 'xpExperiment', experiment: experiment.slug, slots: [
    { slot: 'control', blocks: [{ blockType: 'text', text: 'Original' }] }, { slot: 'variantA', blocks: [{ blockType: 'text', text: 'Winner' }] },
  ] })) }
  const pages = []
  for (const [index, visible] of [true, true, false].entries()) {
    pages.push(await payload.create({ collection: 'impact-pages', req: await request('en'), locale: 'en', overrideAccess: true,
      data: { ...content, title: `English ${suffix}-${index}`, slug: `english-${suffix}-${index}`, editor, visible, _status: 'published' } }))
  }
  // The first page has French metadata but falls back to English content.
  // The second has French content but falls back to English metadata.
  for (const [index, page] of pages.entries()) await payload.update({ collection: 'impact-pages', id: page.id, req: await request('fr'), locale: 'fr', overrideAccess: true,
    data: { ...(index === 1 ? content : { title: `Français ${suffix}-${index}`, slug: `francais-${suffix}-${index}` }), editor, _status: 'published' } })
  const options = payload.config.custom!.xp as ResolvedOptions
  const endpoint = buildEndpoints({ options }).find(route => route.path === '/xp/experiments/:id/delete-impact')!
  for (const locale of ['fr', 'en']) {
    const managerReq = await request(locale)
    managerReq.routeParams = { id: String(experiment.id) }
    // Label language follows the admin language; content language follows req.locale.
    managerReq.i18n = { ...managerReq.i18n, language: 'fr' }
    const fallback = managerReq.fallbackLocale
    const response = await endpoint.handler(managerReq)
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ effect: 'block', pageCount: 3, unreadablePages: 1, placements: expect.arrayContaining(pages.slice(0, 2).map((page, index) => expect.objectContaining({
      id: page.id, title: `${locale === 'fr' && index !== 1 ? 'Français' : 'English'} ${suffix}-${index}`,
      path: `/site/${locale === 'fr' && index !== 1 ? 'francais' : 'english'}-${suffix}-${index}`, locales: ['all languages'],
    }))) })
    expect(result.placements).toHaveLength(2)
    expect(result.placements.map((page: { id: string | number }) => page.id)).not.toContain(pages[2]!.id)
    expect(JSON.stringify(result)).not.toContain(`english-${suffix}-2`)
    expect(JSON.stringify(result)).not.toContain(`francais-${suffix}-2`)
    expect(managerReq.locale).toBe(locale)
    expect(managerReq.fallbackLocale).toEqual(fallback)
  }
}, 30_000) // Estimate <3 s per case; coordinator must measure.

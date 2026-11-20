import { expect, test, vi } from 'vitest'
import { placementPaths } from '../../src/transitions/placementInteractions.js'
import { identicalPageVersions } from '../../src/transitions/pageVersions.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'
import { sampleOptions } from '../collections/fixtures.js'

function fixture() {
  const options = sampleOptions()
  const pathOf = vi.fn((doc: Record<string, unknown>) => { expect(typeof doc.slug).toBe('string'); return `/${doc.slug}` })
  const contentOf = vi.fn((doc: Record<string, unknown>) => { expect(typeof doc.content).toBe('string'); return doc.content })
  const rows = [{ id: 1, _status: 'published', slug: { en: 'z', fr: 'a' }, content: { en: 'Same', fr: 'Original' } },
    { id: 2, _status: 'published', slug: { en: 'a', fr: 'b' }, content: { en: 'Same', fr: 'Different' } }]
  const collection = { slug: 'pages', pathOf, contentOf, findByPath: async (path: string) => ({ id: path === '/original' ? 1 : 2, published: true }) }
  options.pages = { collections: [collection] }
  const payload = fakePayload({ config: { custom: { xp: options }, localization: { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }] },
    collections: [{ slug: 'pages', fields: [{ name: 'slug', type: 'text', localized: true }, { name: 'content', type: 'text', localized: true }] }] } })
  Object.assign(payload.db, { findOne: vi.fn(async ({ where }) => rows.find(row => row.id === where.id.equals)) })
  return { options, collection, rows, req: fakeReq({ payload }), pathOf, contentOf }
}

test('placement paths project every document language and deduplicate in the existing lock order', async () => {
  const f = fixture()
  expect(await placementPaths(f.req, f.options, [{ collection: 'pages', id: 1 }, { collection: 'pages', id: 2 }])).toEqual(['/a', '/b', '/z'])
  expect(f.pathOf.mock.calls.map(([doc]) => doc.slug)).toEqual(['z', 'a', 'a', 'b'])
})

test('page version comparisons call contentOf with locale views and compare every language', async () => {
  const f = fixture()
  const arms = defaultArms('page').map((arm, index) => ({ ...arm, pageTarget: index ? '/variant' : '/original' }))
  expect(await identicalPageVersions(f.req, f.collection, arms)).toEqual([])
  expect(f.contentOf.mock.calls.map(([doc]) => doc.content)).toEqual(['Same', 'Original', 'Same', 'Different'])
  f.rows[1]!.content.fr = 'Original'
  expect(await identicalPageVersions(f.req, f.collection, arms)).toEqual([{ arm: 'variantA', path: '/variant', collection: 'pages', id: 2 }])
})

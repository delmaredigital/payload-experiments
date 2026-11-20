import { expect, test } from 'vitest'
import { buildSurfaceProps } from '../../src/admin/views/buildSurfaceProps.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'

test('new-test choices pass already-localized Local API documents through unchanged', async () => {
  const options = sampleOptions(); options.flagPoints = []; options.access.manage = () => true
  options.puck = { enabled: true, collections: ['pages'] }
  options.blocks = { collections: [{ slug: 'pages', field: 'layout', appliesTo: doc => { expect(doc.title).toBe('French page'); return true } }] }
  const payload = fakePayload({ config: { custom: { xp: options }, routes: { api: '/api', admin: '/admin' }, admin: { user: 'users' },
    localization: { defaultLocale: 'en', localeCodes: ['en', 'fr'], locales: [{ code: 'en' }, { code: 'fr' }] },
    collections: [{ slug: 'pages', labels: { plural: 'Pages' }, admin: { useAsTitle: 'title' }, fields: [{ name: 'title', type: 'text', localized: true }] }] },
    collections: { pages: [{ id: 1, title: 'French page' }] } })
  const req = fakeReq({ payload, user: { id: 1 } }); req.locale = 'fr'
  const props = await buildSurfaceProps({ req, route: 'new', searchParams: {} })
  expect(props?.pages).toMatchObject([{ id: 1, title: 'French page', editor: 'blocks' }])
})

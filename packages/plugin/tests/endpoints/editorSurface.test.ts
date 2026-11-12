import { expect, test, vi } from 'vitest'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { sampleOptions } from '../collections/fixtures.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import type { ExperimentsAccess } from '../../src/types/contracts.js'

function setup(manage: unknown, readResults: unknown, user: boolean = true) {
  const options = sampleOptions()
  options.access = { manage: vi.fn(async () => manage) as ExperimentsAccess,
    readResults: vi.fn(async () => readResults) as ExperimentsAccess, admin: () => false }
  const findGlobal = vi.fn(async () => ({ flagDefaults: { cta: { params: { title: 'Stored default' } } } }))
  const payload = fakePayload({ config: { custom: { xp: options }, routes: { admin: '/manage', api: '/custom-api' },
    admin: { user: 'users' }, collections: [{ slug: 'pages', admin: { useAsTitle: 'title' } }] }, overrides: { findGlobal } })
  const req = fakeReq({ payload, user: user ? { id: 'person' } : null })
  const endpoint = buildEndpoints({ options }).find(item => item.path === '/xp/editor-surface')!
  return { req, endpoint, findGlobal, options }
}

test('manager receives the same serialized configuration and effective defaults as the admin page', async () => {
  const { req, endpoint, findGlobal } = setup(true, true)
  const response = await endpoint.handler(req)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  const body = await response.json()
  expect(Object.keys(body).sort()).toEqual(['adminRoute', 'apiRoute', 'canManage', 'canReadResults', 'isAdmin', 'flagPoints', 'pageCollections', 'collectionTitles', 'userId', 'userCollection', 'attributeKeys', 'metricSources'].sort())
  expect(body).toMatchObject({ canManage: true, canReadResults: true, apiRoute: '/custom-api', adminRoute: '/manage',
    flagPoints: [{ id: 'cta', effectiveDefaults: { title: 'Stored default' } }], collectionTitles: { pages: 'title' },
    attributeKeys: { country: { type: 'string' } }, metricSources: expect.any(Array), pageCollections: [] })
  expect(findGlobal).toHaveBeenCalledWith({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
})

test('results-only reader gets reader permissions without a manager state read', async () => {
  const { req, endpoint, findGlobal } = setup(false, true)
  const response = await endpoint.handler(req)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ canManage: false, canReadResults: true })
  expect(findGlobal).not.toHaveBeenCalled()
})

test.each([false, 'yes', {}])('no access or truthy access is forbidden (%j)', async access => {
  const { req, endpoint, findGlobal } = setup(access, access)
  const response = await endpoint.handler(req)
  expect(response.status).toBe(403)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(findGlobal).not.toHaveBeenCalled()
})

test('logged out is 401 without evaluating access', async () => {
  const { req, endpoint, options } = setup(true, true, false)
  const response = await endpoint.handler(req)
  expect(response.status).toBe(401)
  expect(options.access.manage).not.toHaveBeenCalled()
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
})

test('one endpoint does not retain permissions between users', async () => {
  const { req, endpoint, options } = setup(true, true)
  expect((await endpoint.handler(req)).status).toBe(200)
  vi.mocked(options.access.manage).mockResolvedValue(false)
  vi.mocked(options.access.readResults!).mockResolvedValue(false)
  req.user = { id: 'other', collection: 'users' }
  expect((await endpoint.handler(req)).status).toBe(403)
})

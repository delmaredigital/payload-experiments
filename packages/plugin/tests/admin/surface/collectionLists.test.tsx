import { isValidElement } from 'react'
import { createLocalReq, sanitizeConfig } from 'payload'
import type { Config, ListViewServerProps, SanitizedConfig } from 'payload'
import { beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { TestsCollectionListView } from '../../../src/admin/views/TestsCollectionListView.js'
import { GoalsCollectionListView } from '../../../src/admin/views/GoalsCollectionListView.js'
import { createExperimentsPlugin } from '../../../src/plugin.js'
import { sampleOptions } from '../../collections/fixtures.js'
import { fakePayload } from '../../_fakes/payload.js'

const mocks = vi.hoisted(() => ({
  headers: new Headers({ cookie: 'session=request-session' }),
  render: vi.fn((..._args: unknown[]) => null),
  redirect: vi.fn((url: string): never => { throw new Error(`redirect:${url}`) }),
}))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@payloadcms/ui/elements/RenderServerComponent', () => ({ RenderServerComponent: mocks.render }))

let config: SanitizedConfig
beforeAll(async () => {
  config = await sanitizeConfig(await createExperimentsPlugin(sampleOptions())({
    secret: 'test-only', db: {} as Config['db'], routes: { admin: '/control', api: '/data' },
    collections: [{ slug: 'editors', auth: true, fields: [{ name: 'role', type: 'text' }] }],
    admin: { user: 'editors', routes: { login: '/sign-in' } },
  }))
})
beforeEach(() => vi.clearAllMocks())

async function setup(slug: string, role: string | null = 'manager') {
  const fullUser = role === null ? null : { id: 'signed-in', collection: 'editors', role }
  const auth = vi.fn(async () => ({ user: fullUser }))
  const findGlobal = vi.fn(async () => ({ flagDefaults: { cta: { params: { title: 'Shipped' } } } }))
  const manage = vi.fn(({ req }: Parameters<ReturnType<typeof sampleOptions>['access']['manage']>[0]) => req.user?.role === 'manager')
  const admin = vi.fn(() => false)
  const readResults = vi.fn(() => true)
  const options = { ...sampleOptions(), access: { manage, admin, readResults }, admin: { descriptions: { setting: 'Choose a setting.' } } }
  const payload = fakePayload({ config: { ...config, custom: { xp: options } }, overrides: { auth, findGlobal, importMap: {} } })
  const req = await createLocalReq({}, payload)
  // These are actual list props, including Payload's field-filtered user. There is no initPageResult or req.
  const props = {
    collectionConfig: config.collections.find(item => item.slug === slug)!, collectionSlug: slug,
    data: { docs: [], totalDocs: 0, totalPages: 1, page: 1, limit: 10, pagingCounter: 1, hasNextPage: false, hasPrevPage: false, nextPage: null, prevPage: null },
    i18n: req.i18n, limit: 10, listPreferences: {}, listSearchableFields: [],
    params: { segments: ['collections', slug] }, payload, permissions: { collections: { [slug]: { fields: {}, read: true } } },
    searchParams: { return: 'test-1', filter: ['one', 'two'] }, user: { id: 'signed-in', collection: 'editors' },
    columnState: [], hasCreatePermission: true, newDocumentURL: `/control/collections/${slug}/create`, viewType: 'list', Table: null,
  } satisfies ListViewServerProps
  return { props, fullUser, auth, findGlobal, manage, admin, readResults }
}
const views = [[TestsCollectionListView, 'xp-experiments', 'home'], [GoalsCollectionListView, 'xp-metrics', 'goals']] as const

test.each(views)('%s renders %s in place with the full authenticated principal and shared surface props', async (View, slug, route) => {
  const { props, fullUser, auth, findGlobal, manage, admin, readResults } = await setup(slug)
  await View(props)
  expect(auth).toHaveBeenCalledExactlyOnceWith({ headers: mocks.headers })
  const req = manage.mock.calls[0]![0].req
  expect(req.user).toEqual(fullUser)
  expect(req.headers).toBe(mocks.headers)
  expect(admin).toHaveBeenCalledExactlyOnceWith({ req })
  expect(readResults).toHaveBeenCalledExactlyOnceWith({ req })
  expect(findGlobal).toHaveBeenCalledExactlyOnceWith({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clientProps: expect.objectContaining({
    route, canManage: true, canReadResults: true, isAdmin: false, adminRoute: '/control', apiRoute: '/data',
    returnToTest: 'test-1', userId: 'signed-in', userCollection: 'editors',
    flagPoints: [expect.objectContaining({ effectiveDefaults: { title: 'Shipped' } })],
    attributeKeys: expect.any(Object), metricSources: expect.any(Array), collectionTitles: expect.any(Object),
    pageCollections: [], admin: { descriptions: { setting: 'Choose a setting.' } },
  }) }))
  expect(mocks.redirect).not.toHaveBeenCalled()
})

test.each(views)('%s defensively refuses a non-manager (Payload normally 404s before the list override)', async (View, slug) => {
  const { props, findGlobal } = await setup(slug, 'reader')
  const result = await View(props)
  expect(isValidElement(result) && result.props).toMatchObject({ children: "You don't have access to tests." })
  expect(findGlobal).not.toHaveBeenCalled()
  expect(mocks.render).not.toHaveBeenCalled()
  expect(mocks.redirect).not.toHaveBeenCalled()
})

test.each(views)('%s defensively sends an absent session user to login (Payload normally redirects first)', async (View, slug) => {
  const { props, manage } = await setup(slug, null)
  const current = `/control/collections/${slug}?return=test-1&filter=one&filter=two`
  await expect(View(props)).rejects.toThrow(`redirect:/control/sign-in?redirect=${encodeURIComponent(current)}`)
  expect(manage).not.toHaveBeenCalled()
  expect(mocks.render).not.toHaveBeenCalled()
})

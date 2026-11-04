import { isValidElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AdminViewServerProps } from 'payload'
import { beforeEach, expect, test, vi } from 'vitest'
import { ExperimentsRootView } from '../../../src/admin/views/ExperimentsRootView.js'
import { XP_TESTS_SURFACE } from '../../../src/admin/paths.js'
import type { ExperimentsAccess, ExperimentsPluginOptions } from '../../../src/types/contracts.js'
import type { TestsSurfaceProps } from '../../../src/types/surface.js'
import { fakeReq } from '../../_fakes/req.js'
import { fakePayload } from '../../_fakes/payload.js'
import { fakeInitPageResult } from '../_helpers/fakeInitPageResult.js'

const mocks = vi.hoisted(() => ({
  render: vi.fn((..._args: unknown[]): import('react').ReactNode => null),
  redirect: vi.fn((url: string): never => { throw new Error(`redirect:${url}`) }),
  notFound: vi.fn((): never => { throw new Error('not-found') }),
}))
vi.mock('@payloadcms/ui/elements/RenderServerComponent', () => ({ RenderServerComponent: mocks.render }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
beforeEach(() => vi.clearAllMocks())
function setup({ user = true, manage = () => true, readResults, adminRoute = '/control', loginRoute = '/login', admin, puck, pageDocs = {}, deniedCollections = [], editorUrl = () => '/editor' }: {
  admin?: ExperimentsAccess; puck?: ExperimentsPluginOptions['puck']; editorUrl?: NonNullable<ExperimentsPluginOptions['admin']>['editorUrl']
  pageDocs?: Record<string, Array<{ id: string | number; title?: string; heading?: string }>>; deniedCollections?: string[]
  user?: boolean; manage?: ExperimentsAccess; readResults?: ExperimentsAccess; adminRoute?: string; loginRoute?: string
} = {}) {
  const findGlobal = vi.fn(async () => ({ flagDefaults: { saved: { params: { text: 'Shipped' } } } }))
  const find = vi.fn(async ({ collection }: { collection: string }) => {
    if (deniedCollections.includes(collection)) throw new Error('Forbidden')
    return { docs: pageDocs[collection] ?? [] }
  })
  const payload = fakePayload({ config: { collections: [{ slug: 'pages', admin: { useAsTitle: 'title' }, labels: { plural: 'Pages' } }, { slug: 'articles', admin: { useAsTitle: 'heading' }, labels: { plural: 'Articles' } }], routes: { admin: adminRoute, api: '/data' }, admin: { routes: { login: loginRoute } }, custom: { xp: {
    access: { manage, ...(admin ? { admin } : {}), ...(readResults ? { readResults } : {}) },
    ...(puck ? { puck } : {}),
    flagPoints: ['saved', 'fallback'].map(id => ({ id, label: id, params: { text: { type: 'text', label: 'Text' } }, defaultParams: { text: 'Original' }, placements: () => [], makeContent: () => {} })),
    attributeKeys: { role: { type: 'string', values: ['student'] } },
    metricSources: [{ id: 'goal', label: 'Goal', kind: 'binomial', keyedBy: 'visitor', query: () => [] }],
    admin: { descriptions: { setting: 'Choose a setting.' }, editorUrl, previewUrl: () => '/preview' },
  } } }, overrides: { find, findGlobal, importMap: {} } })
  const req = fakeReq({ payload, user: user ? { id: 'manager' } : null })
  const props = {
    initPageResult: fakeInitPageResult({ req }), params: {}, searchParams: {},
  } satisfies Pick<AdminViewServerProps, 'initPageResult' | 'params' | 'searchParams'>
  return { props, req, payload, findGlobal, find }
}
const routes = [
  [['goals'], 'goals', undefined], [['goals', 'new'], 'goalNew', undefined], [['goals', 'goal-1'], 'goal', 'goal-1'],
  [[], 'home', undefined], [['new'], 'new', undefined], [['123'], 'test', '123'], [['123', 'results'], 'results', '123'],
] as const
test.each(['123', 'test-uuid_1'])('valid goals return context %s is serialized for the client surface', async returnToTest => {
  const { props } = setup()
  await ExperimentsRootView({ ...props, params: { segments: ['experiments', 'goals', 'new'] }, searchParams: { return: returnToTest } })
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clientProps: expect.objectContaining({ route: 'goalNew', returnToTest }) }))
})
test.each(['..', 'test/1', '', ['123']])('invalid goals return context %j is ignored', async returnToTest => {
  const { props } = setup()
  await ExperimentsRootView({ ...props, params: { segments: ['experiments', 'goals', 'new'] }, searchParams: { return: returnToTest } })
  const { clientProps } = mocks.render.mock.calls[0]![0] as { clientProps: TestsSurfaceProps }
  expect(clientProps).not.toHaveProperty('returnToTest')
})
test.each(routes)('%j dispatches to %s through the import map', async (tail, route, id) => {
  const { props, payload, req, findGlobal } = setup()
  await ExperimentsRootView({ ...props, params: { segments: ['experiments', ...tail] }, searchParams: {} })
  expect(mocks.render).toHaveBeenCalledWith({ Component: XP_TESTS_SURFACE, Fallback: expect.any(Function), importMap: payload.importMap, clientProps: expect.objectContaining({ route, ...(id ? { id } : {}) }) })
  const clientProps = (mocks.render.mock.calls[0] as unknown as [{ clientProps: TestsSurfaceProps }])[0].clientProps
  function noFunctions(value: unknown) {
    expect(typeof value).not.toBe('function')
    if (value && typeof value === 'object') Object.values(value).forEach(noFunctions)
  }
  noFunctions(clientProps)
  expect(clientProps.flagPoints.map(point => point.effectiveDefaults)).toEqual([{ text: 'Shipped' }, { text: 'Original' }])
  expect(clientProps.admin).toEqual({ descriptions: { setting: 'Choose a setting.' } })
  expect(clientProps.metricSources[0]).not.toHaveProperty('query')
  expect(clientProps).toMatchObject({ adminRoute: '/control', apiRoute: '/data', canManage: true, canReadResults: true })
  expect(findGlobal).toHaveBeenCalledWith({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
})
test.each(routes)('%s sends unauthenticated users to login', async (tail) => {
  const { props, findGlobal } = setup({ user: false })
  const current = `/control/experiments${tail.length ? `/${tail.join('/')}` : ''}?locale=en`
  await expect(ExperimentsRootView({ ...props, params: { segments: ['experiments', ...tail] }, searchParams: { locale: 'en' } })).rejects.toThrow('redirect:')
  expect(mocks.redirect).toHaveBeenCalledWith(`/control/login?redirect=${encodeURIComponent(current)}`)
  expect(mocks.render).not.toHaveBeenCalled()
  expect(findGlobal).not.toHaveBeenCalled()
})
test.each(routes)('%s refuses a user without permission', async tail => {
  const { props, findGlobal } = setup({ manage: () => false })
  const result = await ExperimentsRootView({ ...props, params: { segments: ['experiments', ...tail] } })
  expect(isValidElement(result) && result.props).toMatchObject({ children: "You don't have access to tests." })
  expect(mocks.render).not.toHaveBeenCalled()
  expect(findGlobal).not.toHaveBeenCalled()
})
test.each(routes)('%s grants results-only permission only on results', async (tail, route) => {
  const { props, findGlobal } = setup({ manage: () => false, readResults: () => true })
  await ExperimentsRootView({ ...props, params: { segments: ['experiments', ...tail] } })
  expect(mocks.render).toHaveBeenCalledTimes(route === 'results' ? 1 : 0)
  if (route === 'results') expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clientProps: expect.objectContaining({ canManage: false, canReadResults: true }) }))
  expect(findGlobal).not.toHaveBeenCalled()
})
test.each([() => 'yes', () => { throw new Error('denied') }])('a non-boolean or throwing manager cannot enter', async manage => {
  const { props } = setup({ manage: manage as unknown as ExperimentsAccess })
  await ExperimentsRootView({ ...props, params: { segments: ['experiments'] } })
  expect(mocks.render).not.toHaveBeenCalled()
})
test('results honours an explicit readResults denial even for a manager', async () => {
  const { props } = setup({ readResults: () => false })
  await ExperimentsRootView({ ...props, params: { segments: ['experiments', '123', 'results'] } })
  expect(mocks.render).not.toHaveBeenCalled()
})
test.each([['123', 'other'], ['123', 'results', 'extra']])('unknown segments %s call notFound', async (...segments) => {
  const { props } = setup()
  await expect(ExperimentsRootView({ ...props, params: { segments: ['experiments', ...segments] } })).rejects.toThrow('not-found')
  expect(mocks.notFound).toHaveBeenCalledOnce()
  expect(mocks.render).not.toHaveBeenCalled()
})

test.each(['/control', '/'])('login uses the configured login path with admin at %s', async adminRoute => {
  const { props } = setup({ user: false, adminRoute, loginRoute: '/sign-in' })
  const current = `${adminRoute === '/' ? '' : adminRoute}/experiments/123/results?locale=en`
  await expect(ExperimentsRootView({ ...props, params: { segments: ['experiments', '123', 'results'] }, searchParams: { locale: 'en' } })).rejects.toThrow('redirect:')
  expect(mocks.redirect).toHaveBeenCalledWith(`${adminRoute === '/' ? '' : adminRoute}/sign-in?redirect=${encodeURIComponent(current)}`)
})
test('missing import-map component renders the server fallback', async () => {
  mocks.render.mockImplementationOnce((...args: unknown[]) => {
    const { Fallback, Component, importMap } = args[0] as { Fallback: ComponentType; Component: string; importMap: Record<string, unknown> }
    return importMap[Component] ? null : <Fallback />
  })
  const { props } = setup()
  const result = await ExperimentsRootView({ ...props, params: { segments: ['experiments'] } })
  const html = renderToStaticMarkup(result)
  expect(html).toContain('role="alert"')
  expect(html).toContain("The Tests screen isn&#x27;t installed yet. Run `payload generate:importmap` and reload.")
})

test.each([
  [undefined, false], [(): boolean => true, true], [(): boolean => false, false], [() => { throw new Error('denied') }, false],
] as const)('admin access is independently resolved with boolean-only permits', async (admin, expected) => {
  const { props } = setup({ admin })
  await ExperimentsRootView({ ...props, params: { segments: ['new'] } })
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clientProps: expect.objectContaining({ isAdmin: expected }) }))
})
test('new route loads recent Puck pages with access checked and preserves numeric and string ids', async () => {
  const editorUrl = vi.fn(({ id }: { id: string | number }) => `/page-editor/${id}`)
  const { props, find, req } = setup({ puck: { enabled: true, collections: ['pages', { slug: 'articles', field: 'body' }] },
    pageDocs: { pages: [{ id: 12, title: 'Welcome' }], articles: [{ id: 'uuid', heading: 'Story' }] }, editorUrl })
  await ExperimentsRootView({ ...props, params: { segments: ['new'] } })
  expect(find.mock.calls).toEqual([
    [{ collection: 'pages', req, overrideAccess: false, depth: 0, limit: 50, sort: '-updatedAt', draft: false }],
    [{ collection: 'articles', req, overrideAccess: false, depth: 0, limit: 50, sort: '-updatedAt', draft: false }],
  ])
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clientProps: expect.objectContaining({ pages: [
    { collection: 'pages', collectionLabel: 'Pages', id: 12, title: 'Welcome', editorUrl: '/page-editor/12' },
    { collection: 'articles', collectionLabel: 'Articles', id: 'uuid', title: 'Story', editorUrl: '/page-editor/uuid' },
  ] }) }))
  expect(editorUrl).toHaveBeenCalledWith({ collection: 'pages', id: 12, draft: false, editor: 'puck', doc: { id: 12, title: 'Welcome' } })
})
test('failed collection reads are skipped, missing titles and editor URLs have configured-route fallbacks', async () => {
  const { props, find } = setup({ puck: { enabled: true, collections: ['pages', 'articles', 'other'] }, deniedCollections: ['pages'],
    pageDocs: { articles: [{ id: 'uuid' }], other: [{ id: 7 }] }, editorUrl: () => undefined as unknown as string })
  await ExperimentsRootView({ ...props, params: { segments: ['new'] } })
  expect(find).toHaveBeenCalledTimes(3)
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clientProps: expect.objectContaining({ pages: [
    { collection: 'articles', collectionLabel: 'Articles', id: 'uuid', title: 'uuid', editorUrl: '/control/collections/articles/uuid' },
    { collection: 'other', collectionLabel: 'other', id: 7, title: '7', editorUrl: '/control/collections/other/7' },
  ] }) }))
  expect(find).toHaveBeenCalledWith(expect.objectContaining({ collection: 'other', draft: false, depth: 0 }))
})
test.each([[], ['12'], ['12', 'results']].map(segments => [segments]))('pages are not loaded for route %j', async segments => {
  const { props, find } = setup({ puck: { enabled: true, collections: ['pages'] } })
  await ExperimentsRootView({ ...props, params: { segments } })
  expect(find).not.toHaveBeenCalled()
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clientProps: expect.not.objectContaining({ pages: expect.anything() }) }))
})
test('a results-only reader never loads pages even when Puck is configured', async () => {
  const { props, find } = setup({ manage: () => false, readResults: () => true, puck: { enabled: true, collections: ['pages'] } })
  await ExperimentsRootView({ ...props, params: { segments: ['12', 'results'] } })
  expect(find).not.toHaveBeenCalled()
})
test('configured Puck with no readable pages still offers the block hand-off', async () => {
  const { props } = setup({ puck: { enabled: true, collections: ['pages'] }, deniedCollections: ['pages'] })
  await ExperimentsRootView({ ...props, params: { segments: ['new'] } })
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clientProps: expect.objectContaining({ pages: [] }) }))
})


test.each([
  { enabled: false, collections: ['pages'] },
  { enabled: true, collections: [] },
])('block hand-off requires enabled Puck and registered collections: %j', async puck => {
  const { props, find } = setup({ puck })
  await ExperimentsRootView({ ...props, params: { segments: ['new'] } })
  expect(find).not.toHaveBeenCalled()
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clientProps: expect.not.objectContaining({ pages: expect.anything() }) }))
})


test('a per-language collection label picks a readable string without a translation dependency', async () => {
  const { props, payload } = setup({ puck: { enabled: true, collections: ['pages'] }, pageDocs: { pages: [{ id: 12, title: 'Welcome' }] } })
  payload.config.collections[0]!.labels.plural = { en: 'Pages', fr: 'Pages françaises' }
  await ExperimentsRootView({ ...props, params: { segments: ['new'] } })
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clientProps: expect.objectContaining({ pages: [
    expect.objectContaining({ collectionLabel: 'Pages' }),
  ] }) }))
})


test('root emits exactly one scoped accent style only when configured', async () => {
  const { props, payload } = setup()
  expect(renderToStaticMarkup(await ExperimentsRootView(props))).not.toContain('<style>')
  const xp = payload.config.custom.xp as ExperimentsPluginOptions
  xp.theme = { accent: '#1f3a68' }
  const html = renderToStaticMarkup(await ExperimentsRootView(props))
  expect(html.match(/<style>/g)).toHaveLength(1)
  expect(html).toContain('--xp-accent:#1f3a68;')
  expect(html).toContain('[data-theme="dark"][data-theme="dark"]')
  const declarations = [...html.matchAll(/(--[\w-]+):/g)].map(match => match[1])
  expect(declarations.every(name => name === '--xp-focus' || name?.startsWith('--xp-accent'))).toBe(true)
})

import { isValidElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AdminViewServerProps } from 'payload'
import { beforeEach, expect, test, vi } from 'vitest'
import { ExperimentsRootView } from '../../../src/admin/views/ExperimentsRootView.js'
import { XP_TESTS_SURFACE } from '../../../src/admin/paths.js'
import type { ExperimentsAccess } from '../../../src/types/contracts.js'
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
function setup({ user = true, manage = () => true, readResults, adminRoute = '/control', loginRoute = '/login' }: {
  user?: boolean; manage?: ExperimentsAccess; readResults?: ExperimentsAccess; adminRoute?: string; loginRoute?: string
} = {}) {
  const findGlobal = vi.fn(async () => ({ flagDefaults: { saved: { params: { text: 'Shipped' } } } }))
  const payload = fakePayload({ config: { routes: { admin: adminRoute, api: '/data' }, admin: { routes: { login: loginRoute } }, custom: { xp: {
    access: { manage, ...(readResults ? { readResults } : {}) },
    flagPoints: ['saved', 'fallback'].map(id => ({ id, label: id, params: { text: { type: 'text', label: 'Text' } }, defaultParams: { text: 'Original' }, placements: () => [], makeContent: () => {} })),
    attributeKeys: { role: { type: 'string', values: ['student'] } },
    metricSources: [{ id: 'goal', label: 'Goal', kind: 'binomial', keyedBy: 'visitor', query: () => [] }],
    admin: { descriptions: { setting: 'Choose a setting.' }, editorUrl: () => '/editor', previewUrl: () => '/preview' },
  } } }, overrides: { findGlobal, importMap: {} } })
  const req = fakeReq({ payload, user: user ? { id: 'manager' } : null })
  const props = {
    initPageResult: fakeInitPageResult({ req }), params: {}, searchParams: {},
  } satisfies Pick<AdminViewServerProps, 'initPageResult' | 'params' | 'searchParams'>
  return { props, req, payload, findGlobal }
}
const routes = [
  [[], 'home', undefined], [['new'], 'new', undefined], [['123'], 'test', '123'], [['123', 'results'], 'results', '123'],
] as const
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

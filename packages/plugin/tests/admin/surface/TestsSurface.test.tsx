// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { TestsSurfaceProps } from '../../../src/types/surface.js'
import type { SurfaceProps } from '../../../src/admin/surface/contracts.js'
import { TestsSurface } from '../../../src/admin/surface/TestsSurface.js'

const routes = vi.hoisted(() => ({ home: vi.fn(), newTest: vi.fn(), test: vi.fn(), results: vi.fn() }))
vi.mock('@payloadcms/ui', () => ({ Link: (props: ComponentProps<'a'>) => <a {...props} /> }))
vi.mock('../../../src/admin/surface/TestsHome.js', () => ({ TestsHome: (props: unknown) => { routes.home(props); return <p>Home body</p> } }))
vi.mock('../../../src/admin/surface/newTest/NewTest.js', () => ({ NewTest: (props: unknown) => { routes.newTest(props); return <p>New body</p> } }))
vi.mock('../../../src/admin/surface/test/TestPage.js', () => ({ TestPage: (props: unknown) => { routes.test(props); return <p>Setup body</p> } }))
vi.mock('../../../src/admin/surface/ResultsRoute.js', () => ({ ResultsRoute: (props: unknown) => { routes.results(props); return <p>Results body</p> } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const props: TestsSurfaceProps = {
  route: 'home', id: '123', adminRoute: '/control', apiRoute: '/data', canManage: true, canReadResults: true,
  isAdmin: true, flagPoints: [], attributeKeys: {}, metricSources: [], admin: { descriptions: { setting: 'Site choices.' } },
  pages: [{ collection: 'pages', collectionLabel: 'Pages', id: 2, title: 'Welcome', editorUrl: '/editor/2' }],
}
const surface: SurfaceProps = {
  adminRoute: props.adminRoute, apiRoute: props.apiRoute, canManage: true, canReadResults: true, isAdmin: true,
  flagPoints: [], attributeKeys: {}, metricSources: [], descriptions: props.admin!.descriptions,
}
test.each([
  ['home', 'Home body'], ['new', 'New body'], ['test', 'Setup body'], ['results', 'Results body'],
] as const)('dispatches %s into the shared shell', (route, body) => {
  render(<TestsSurface {...props} route={route} />)
  expect(screen.getByRole('main').textContent).toBe(body)
  expect(screen.getByRole('link', { name: 'Tests' }).getAttribute('href')).toBe('/control/experiments')
  expect(screen.getByRole('link', { name: 'Back to admin' }).getAttribute('href')).toBe('/control')
  expect(routes.home).toHaveBeenCalledTimes(route === 'home' ? 1 : 0)
  expect(routes.newTest).toHaveBeenCalledTimes(route === 'new' ? 1 : 0)
  expect(routes.test).toHaveBeenCalledTimes(route === 'test' ? 1 : 0)
  expect(routes.results).toHaveBeenCalledTimes(route === 'results' ? 1 : 0)
  if (route === 'home') expect(routes.home).toHaveBeenCalledWith({ adminRoute: '/control', apiRoute: '/data' })
  if (route === 'new') expect(routes.newTest).toHaveBeenCalledWith({ surface, pages: props.pages })
  if (route === 'test') expect(routes.test).toHaveBeenCalledWith({ id: '123', surface })
  if (route === 'results') expect(routes.results).toHaveBeenCalledWith({ id: '123', surface })
})

// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { TestsSurfaceProps } from '../../../src/types/surface.js'
import { TestsSurface } from '../../../src/admin/surface/TestsSurface.js'
import { props as testProps } from './readiness/fixtures.js'

const hook = vi.hoisted(() => vi.fn())
vi.mock('@payloadcms/ui', () => ({ Link: (props: ComponentProps<'a'>) => <a {...props} /> }))
vi.mock('next/navigation.js', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../../../src/admin/surface/useTestDocument.js', () => ({ useTestDocument: hook }))
vi.mock('../../../src/admin/surface/results/ResultsBody.js', () => ({ ResultsBody: () => <p>Results body</p> }))
vi.mock('../../../src/admin/surface/readiness/parts.js', () => ({ readinessParts: {
  Banner: () => null, SaveStatus: () => null,
  sectionDone: () => ({ what: false, versions: false, win: false, who: true, length: false, advanced: true }),
} }))
beforeEach(() => {
  hook.mockReturnValue(testProps({ id: '123' }).test)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ docs: [], totalDocs: 0 }))))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const props: TestsSurfaceProps = {
  route: 'home', id: '123', adminRoute: '/control', apiRoute: '/data', canManage: true, canReadResults: true,
  isAdmin: true, flagPoints: [], attributeKeys: {}, metricSources: [], admin: { descriptions: { setting: 'Site choices.' } },
  pages: [{ collection: 'pages', collectionLabel: 'Pages', id: 2, title: 'Welcome', editorUrl: '/editor/2' }],
}
test.each(['/control', '/'])('dispatches real home / new / test / results pages inside one shared main at %s', async adminRoute => {
  const root = adminRoute === '/' ? '' : adminRoute
  for (const [route, labels] of [
    ['home', ['Tests']], ['new', ['Tests', 'New test']], ['test', ['Tests', 'Test']], ['results', ['Tests', 'Results']],
  ] as const) {
    const view = render(<TestsSurface {...props} adminRoute={adminRoute} route={route} />)
    await act(async () => {})
    const main = screen.getByRole('main')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main.classList.contains('xp-tests-main')).toBe(true)
    const header = main.previousElementSibling as HTMLElement
    expect(header.classList.contains('xp-tests-shell-header')).toBe(true)
    const crumbs = within(header).getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getAllByRole('listitem').map(item => item.textContent?.replace('›', ''))).toEqual(labels)
    expect(within(crumbs).getByText(labels[labels.length - 1]!).getAttribute('aria-current')).toBe('page')
    if (route === 'home') {
      expect(within(crumbs).queryByRole('link')).toBeNull()
      expect(within(crumbs).getByText('Tests').hasAttribute('href')).toBe(false)
      expect(await within(main).findByText('Create a test to learn what works.')).toBeTruthy()
      expect(within(header).getByRole('link', { name: 'Goals' }).getAttribute('href')).toBe(`${root}/experiments/goals`)
    } else {
      expect(within(crumbs).getByRole('link', { name: 'Tests' }).getAttribute('href')).toBe(`${root}/experiments`)
      if (route === 'new') {
        expect(within(main).getByRole('heading', { name: 'What do you want to test?' })).toBeTruthy()
        fireEvent.click(within(main).getByRole('button', { name: /A block on a page/ }))
        expect(within(main).getByText('Welcome')).toBeTruthy()
        expect(within(main).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/editor/2')
      } else {
        expect(within(main).getByLabelText('Test name')).toBeTruthy()
        expect(hook).toHaveBeenCalledWith('123', { apiRoute: '/data' })
        if (route === 'results') expect(within(main).getByText('Results body')).toBeTruthy()
        else expect(within(main).getByRole('region', { name: /What you're testing/ })).toBeTruthy()
      }
    }
    expect(within(header).getByRole('heading', { level: 1, name: 'Tests' })).toBeTruthy()
    expect(within(header).getByRole('link', { name: 'Back to admin' }).getAttribute('href')).toBe(adminRoute)
    view.unmount()
  }
})

test('results-only readers retain the shared main and the Tests breadcrumb link', () => {
  render(<TestsSurface {...props} route="results" canManage={false} />)
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(within(screen.getByRole('main')).getByText('Results body')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Tests' }).getAttribute('href')).toBe('/control/experiments')
  expect(hook).not.toHaveBeenCalled()
})

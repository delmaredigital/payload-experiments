// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { nextNavigationMock, payloadUiMock, resetNextNavigationMock, resetPayloadUiMock, setAuth, setConfig, setNextNavigation } from '../_helpers/payloadUiMock.js'
import { TestsNavLink } from '../../../src/admin/TestsNavLink.js'

vi.mock('@payloadcms/ui', () => payloadUiMock())
vi.mock('next/navigation', () => nextNavigationMock())
beforeEach(() => {
  resetPayloadUiMock()
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
})
afterEach(() => { cleanup(); resetNextNavigationMock(); vi.unstubAllEnvs() })

test('manager sees both links inside a Tests group, with stable ids and labels', () => {
  setNextNavigation({ pathname: '/admin' })
  const { container } = render(<TestsNavLink />)
  const group = container.querySelector('.nav-group')!
  expect(group.querySelector('.nav-group__label')?.textContent).toBe('Tests')
  for (const [name, id, href] of [
    ['All tests', 'nav-xp-tests', '/admin/experiments'], ['Goals', 'nav-xp-goals', '/admin/experiments/goals'],
  ]) {
    const link = screen.getByRole('link', { name })
    expect(link.id).toBe(id)
    expect(link.getAttribute('href')).toBe(href)
    expect(link.className).toBe('nav__link')
    expect(link.querySelector('.nav__link-label')?.textContent).toBe(name)
    expect(group.contains(link)).toBe(true)
  }
  expect(group.hasAttribute('data-is-open')).toBe(false)
})

test.each([false, undefined, { where: {} }])('non-manager with update=%j sees only All tests', update => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update } } } })
  setNextNavigation({ pathname: '/admin' })
  render(<TestsNavLink />)
  expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['All tests'])
})

test.each([
  ['/admin/experiments', 'nav-xp-tests', 'DIV'],
  ['/admin/experiments/abc', 'nav-xp-tests', 'A'],
  ['/admin/experiments/abc/results', 'nav-xp-tests', 'A'],
  ['/admin/experiments/goals', 'nav-xp-goals', 'DIV'],
  ['/admin/experiments/goals/new', 'nav-xp-goals', 'A'],
  ['/admin/experiments/goals-other', 'nav-xp-tests', 'A'],
  ['/admin/experiments-other', null, null],
  ['/admin/collections/users', null, null],
])('only the correct entry is active on %s', (pathname, activeId, tag) => {
  setNextNavigation({ pathname })
  const { container } = render(<TestsNavLink />)
  const active = container.querySelectorAll('[aria-current="page"]')
  expect(active).toHaveLength(activeId ? 1 : 0)
  expect(container.querySelectorAll('.nav__link-indicator')).toHaveLength(activeId ? 1 : 0)
  if (activeId) {
    expect(active[0]?.id).toBe(activeId)
    expect(active[0]?.tagName).toBe(tag)
    expect(active[0]?.querySelector('.nav__link-indicator')).toBeTruthy()
  }
  for (const entry of container.querySelectorAll('.nav__link')) {
    if (entry.id !== activeId) expect(entry.hasAttribute('aria-current')).toBe(false)
  }
})

test.each(['/control', '/'])('nav hrefs respect admin route %s', admin => {
  setConfig({ config: { routes: { admin, api: '/api' } } })
  const base = admin === '/' ? '' : admin
  setNextNavigation({ pathname: `${base}/experiments/123` })
  render(<TestsNavLink />)
  const link = screen.getByRole('link', { name: 'All tests' })
  expect(link.getAttribute('href')).toBe(`${base}/experiments`)
  expect(link.getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('link', { name: 'Goals' }).getAttribute('href')).toBe(`${base}/experiments/goals`)
})

test('active descendants work when Payload formats trailing slashes', () => {
  vi.stubEnv('NEXT_TRAILING_SLASH', 'true')
  setNextNavigation({ pathname: '/admin/experiments/goals/new/' })
  const { container } = render(<TestsNavLink />)
  expect(screen.getByRole('link', { name: 'Goals' }).getAttribute('href')).toBe('/admin/experiments/goals/')
  expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  expect(container.querySelector('[aria-current="page"]')?.id).toBe('nav-xp-goals')
})

test('exact formatted trailing-slash href renders a div', () => {
  vi.stubEnv('NEXT_TRAILING_SLASH', 'true')
  setNextNavigation({ pathname: '/admin/experiments/' })
  const { container } = render(<TestsNavLink />)
  expect(container.querySelector('#nav-xp-tests')?.tagName).toBe('DIV')
  expect(container.querySelector('#nav-xp-tests')?.getAttribute('aria-current')).toBe('page')
})

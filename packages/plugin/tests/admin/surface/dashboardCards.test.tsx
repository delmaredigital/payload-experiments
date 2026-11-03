// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { payloadUiMock, resetPayloadUiMock, setAuth, setConfig } from '../_helpers/payloadUiMock.js'
import { TestsDashboardCards } from '../../../src/admin/TestsDashboardCards.js'

vi.mock('@payloadcms/ui', () => payloadUiMock())
beforeEach(() => resetPayloadUiMock())
afterEach(() => cleanup())

test('managers see All tests and Goals cards with descriptive links', () => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  render(<TestsDashboardCards />)
  expect(screen.getByRole('region', { name: 'Tests' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 2, name: 'Tests' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 3, name: 'All tests' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 3, name: 'Goals' })).toBeTruthy()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByRole('link', { name: 'Show all tests' }).getAttribute('href')).toBe('/admin/experiments')
  expect(screen.getByRole('link', { name: 'Show all goals' }).getAttribute('href')).toBe('/admin/experiments/goals')
})

test.each([false, undefined, { where: {} }])('non-manager with update=%j sees no dashboard section', update => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update } } } })
  const { container } = render(<TestsDashboardCards />)
  expect(container.innerHTML).toBe('')
})

test('missing permissions render no dashboard section', () => {
  setAuth({ permissions: undefined })
  const { container } = render(<TestsDashboardCards />)
  expect(container.innerHTML).toBe('')
})

test.each(['/control', '/'])('dashboard hrefs respect admin route %s', admin => {
  setConfig({ config: { routes: { admin, api: '/api' } } })
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  render(<TestsDashboardCards />)
  const base = admin === '/' ? '' : admin
  expect(screen.getByRole('link', { name: 'Show all tests' }).getAttribute('href')).toBe(`${base}/experiments`)
  expect(screen.getByRole('link', { name: 'Show all goals' }).getAttribute('href')).toBe(`${base}/experiments/goals`)
})

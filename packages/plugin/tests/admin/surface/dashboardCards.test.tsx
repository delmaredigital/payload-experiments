// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { payloadUiMock, resetPayloadUiMock, setAuth, setConfig } from '../_helpers/payloadUiMock.js'
import { TestsDashboardCards } from '../../../src/admin/TestsDashboardCards.js'

vi.mock('@payloadcms/ui', () => payloadUiMock())
beforeEach(() => resetPayloadUiMock())
afterEach(() => cleanup())

test('deprecated export still renders All tests and Goals cards with descriptive links', () => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  render(<TestsDashboardCards />)
  expect(screen.getByRole('region', { name: 'Tests' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 2, name: 'Tests' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 3, name: 'All tests' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 3, name: 'Goals' })).toBeTruthy()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByRole('link', { name: 'Show all tests' }).getAttribute('href')).toBe('/admin/collections/xp-experiments')
  expect(screen.getByRole('link', { name: 'Show all goals' }).getAttribute('href')).toBe('/admin/collections/xp-metrics')
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
  expect(screen.getByRole('link', { name: 'Show all tests' }).getAttribute('href')).toBe(`${base}/collections/xp-experiments`)
  expect(screen.getByRole('link', { name: 'Show all goals' }).getAttribute('href')).toBe(`${base}/collections/xp-metrics`)
})


test('deprecated export stays callable without plugin injection until 0.5.0', async () => {
  const { createExperimentsPlugin } = await import('../../../src/plugin.js')
  const { sampleOptions } = await import('../../collections/fixtures.js')
  const config = await createExperimentsPlugin(sampleOptions())({ secret: 'test-only', db: {} as import('payload').Config['db'] })
  expect(config.admin?.components?.beforeNavLinks).toBeUndefined()
  expect(config.admin?.components?.beforeDashboard).toBeUndefined()
  expect(config.admin?.dependencies).not.toHaveProperty('xpTestsNav')
})

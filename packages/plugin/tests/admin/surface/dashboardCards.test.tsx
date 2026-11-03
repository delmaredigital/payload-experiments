// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { payloadUiMock, resetPayloadUiMock, setAuth, setConfig } from '../_helpers/payloadUiMock.js'
import { TestsDashboardCards } from '../../../src/admin/TestsDashboardCards.js'

vi.mock('@payloadcms/ui', () => payloadUiMock())
beforeEach(() => resetPayloadUiMock())
afterEach(() => cleanup())

test.each([true, false, undefined, { where: {} }])('cards respect management permission %j', update => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update } } } })
  render(<TestsDashboardCards />)
  expect(screen.getByRole('region', { name: 'Tests' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 2, name: 'Tests' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Tests' }).getAttribute('href')).toBe('/admin/experiments')
  expect(screen.getAllByRole('listitem')).toHaveLength(update === true ? 2 : 1)
  const goals = screen.queryByRole('link', { name: 'Goals' })
  if (update === true) expect(goals?.getAttribute('href')).toBe('/admin/experiments/goals')
  else expect(goals).toBeNull()
})

test.each(['/control', '/'])('dashboard hrefs respect admin route %s', admin => {
  setConfig({ config: { routes: { admin, api: '/api' } } })
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  render(<TestsDashboardCards />)
  const base = admin === '/' ? '' : admin
  expect(screen.getByRole('link', { name: 'Tests' }).getAttribute('href')).toBe(`${base}/experiments`)
  expect(screen.getByRole('link', { name: 'Goals' }).getAttribute('href')).toBe(`${base}/experiments/goals`)
})

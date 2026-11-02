// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { nextNavigationMock, payloadUiMock, resetNextNavigationMock, setConfig, setNextNavigation } from '../_helpers/payloadUiMock.js'
import { TestsNavLink } from '../../../src/admin/TestsNavLink.js'

vi.mock('@payloadcms/ui', () => ({ ...payloadUiMock(), Link: (props: ComponentProps<'a'>) => <a {...props} /> }))
vi.mock('next/navigation', () => nextNavigationMock())
afterEach(() => { cleanup(); resetNextNavigationMock() })
test.each(['/control/experiments', '/control/experiments/123', '/control/experiments/123/results'])('Tests is active on %s', pathname => {
  setConfig({ config: { routes: { admin: '/control', api: '/api' } } })
  setNextNavigation({ pathname })
  render(<TestsNavLink />)
  const link = screen.getByRole('link', { name: 'Tests' })
  expect(link.getAttribute('href')).toBe('/control/experiments')
  expect(link.getAttribute('aria-current')).toBe('page')
  expect(link.className).toContain('nav__link--active')
})
test.each(['/control/collections/xp-metrics', '/control/experiments-other'])('Tests is inactive on %s', pathname => {
  setNextNavigation({ pathname })
  render(<TestsNavLink />)
  expect(screen.getByRole('link').hasAttribute('aria-current')).toBe(false)
})

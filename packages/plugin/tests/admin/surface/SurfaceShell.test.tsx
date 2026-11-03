// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { SurfaceShell } from '../../../src/admin/surface/SurfaceShell.js'
import { Button, StatusChip } from '../../../src/ui/index.js'

afterEach(cleanup)
test('shell renders breadcrumbs, title, status, actions and a custom admin root', () => {
  render(<SurfaceShell adminRoute="/control" crumbs={[{ label: 'Tests', href: '/control/experiments' }, { label: 'Donation ask' }]}
    title="Donation ask" status={<StatusChip status="running" />} actions={<Button>Stop test</Button>}>
    <p>Page content</p>
  </SurfaceShell>)
  const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
  expect(within(crumbs).getByRole('link', { name: 'Tests' }).getAttribute('href')).toBe('/control/experiments')
  expect(within(crumbs).getByText('Donation ask').getAttribute('aria-current')).toBe('page')
  const title = screen.getByRole('heading', { level: 1, name: 'Donation ask' })
  expect(within(title.parentElement!).getByText('Running')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to admin' }).getAttribute('href')).toBe('/control')
  expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Stop test' })).toBeTruthy()
  expect(within(screen.getByRole('main')).getByText('Page content')).toBeTruthy()
})
test('shell defaults preserve existing callers', () => {
  render(<SurfaceShell adminRoute="/">Content</SurfaceShell>)
  expect(screen.getByRole('heading', { level: 1, name: 'Tests' })).toBeTruthy()
  expect(within(screen.getByRole('navigation')).getByText('Tests').getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('link', { name: 'Back to admin' }).getAttribute('href')).toBe('/')
})

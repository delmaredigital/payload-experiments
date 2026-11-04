// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { CopyRoute } from '../../../../src/admin/surface/pagePicker/CopyRoute.js'
const collection = { slug: 'pages', label: 'Pages', contentChecks: false, copyUrl: '/control/collections/pages', copyLabel: 'Open Pages' }
afterEach(cleanup)
test('generic route has three steps, a new-tab link, and a zero-content action slot before the steps', () => {
  const { container } = render(<CopyRoute collection={collection}><div>Picker</div></CopyRoute>)
  const steps = container.querySelectorAll('li')
  expect(steps).toHaveLength(3)
  expect(steps[0]!.textContent).toContain('Open the Original in Pages.')
  expect(steps[1]!.textContent).toBe("Choose Duplicate from the document's actions.")
  expect(steps[2]!.textContent).toBe("Give the copy its own address and save it as a draft. Publish it when it's ready; the test can't start until it is.")
  const link = screen.getByRole('link', { name: 'Open Pages' })
  expect(link.getAttribute('href')).toBe('/control/collections/pages')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noopener')
  const slot = container.querySelector('.xp-copy-route-action')!
  expect(slot.childNodes).toHaveLength(0)
  expect(slot.nextElementSibling?.tagName).toBe('OL')
  expect(screen.getByText('Then choose the page you made.').nextElementSibling?.textContent).toBe('Picker')
})
test('host hint replaces generic instructions entirely and precedes publishing and the picker', () => {
  const { container } = render(<CopyRoute collection={{ ...collection, copyHint: 'Copy in the page tree.', copyUrl: '/tree', copyLabel: 'Open tree' }}><div>Picker</div></CopyRoute>)
  expect(container.textContent).not.toContain('Duplicate')
  expect(container.querySelector('ol')).toBeNull()
  expect(screen.getByText(/Copy in the page tree/).nextElementSibling?.textContent).toContain('Give the copy its own address')
  const link = screen.getByRole('link', { name: 'Open tree' })
  expect(link.getAttribute('href')).toBe('/tree')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(container.querySelector('.xp-copy-route-action')?.nextElementSibling?.textContent).toContain('Copy in the page tree.')
})

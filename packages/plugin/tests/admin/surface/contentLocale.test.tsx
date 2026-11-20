// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TestsSurface } from '../../../src/admin/views/TestsSurfaceClient.js'
import type { TestsSurfaceProps } from '../../../src/types/surface.js'
const locale = vi.hoisted(() => ({ code: 'fr' as string | undefined }))
vi.mock('@payloadcms/ui', () => ({ useLocale: () => locale }))
vi.mock('../../../src/admin/surface/TestsSurface.js', () => ({ TestsSurface: (props: TestsSurfaceProps) => <p data-testid="locale">{props.contentLocale ?? 'default'}</p> }))
afterEach(cleanup)
test('admin entry forwards live Payload content language; missing context keeps server default', () => {
  const props = { route: 'home', apiRoute: '/api', adminRoute: '/admin', canManage: true, canReadResults: true, isAdmin: false, flagPoints: [], attributeKeys: {}, metricSources: [] } satisfies TestsSurfaceProps
  const { rerender } = render(<TestsSurface {...props} />)
  expect(screen.getByTestId('locale').textContent).toBe('fr')
  locale.code = 'en'; rerender(<TestsSurface {...props} />)
  expect(screen.getByTestId('locale').textContent).toBe('en')
  locale.code = undefined; rerender(<TestsSurface {...props} />)
  expect(screen.getByTestId('locale').textContent).toBe('default')
})

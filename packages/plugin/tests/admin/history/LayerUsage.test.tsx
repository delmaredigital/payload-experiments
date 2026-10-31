// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { LayerUsage } from '../../../src/admin/LayerUsage.js'
import { resetPayloadUiMock, setDocumentInfo } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals() })
test('shows per-experiment slice usage and the layer total', async () => {
  setDocumentInfo({ id: 'home', collectionSlug: 'xp-layers' })
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ docs: [
    { name: 'Header', status: 'running', layerSlices: [0, 1] },
    { name: 'Donation', status: 'decided', layerSlices: [2] },
  ] }) }))
  vi.stubGlobal('fetch', fetcher)
  render(<LayerUsage path="usage" field={{ name: 'usage', type: 'ui', admin: {} }} />)
  expect(await screen.findByText('3 of 100 slices in use; 97 free.')).toBeTruthy()
  expect(screen.getByText('Header · Running · 2 slices')).toBeTruthy()
  expect(screen.getByText('Donation · Decided · 1 slice')).toBeTruthy()
})
test.each([undefined, null])('nothing on create (%s)', id => {
  setDocumentInfo({ id })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<LayerUsage path="usage" field={{ name: 'usage', type: 'ui', admin: {} }} />)
  expect(container.textContent).toBe('')
  expect(fetcher).not.toHaveBeenCalled()
})

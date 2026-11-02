// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { LayerUsage } from '../../../src/admin/LayerUsage.js'
import { resetPayloadUiMock, setDocumentInfo } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals() })
test('shows the configured label and description, test percentages and group total', async () => {
  setDocumentInfo({ id: 'home', collectionSlug: 'xp-layers' })
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ docs: [
    { name: 'Header', status: 'running', layerSlices: [0, 1] },
    { name: 'Donation', status: 'decided', layerSlices: [2] },
  ] }) }))
  vi.stubGlobal('fetch', fetcher)
  render(<LayerUsage path="usage" field={{ name: 'usage', type: 'ui', label: 'Tests using this space', admin: { description: 'See which tests use this group and how much room is left.' } }} />)
  expect(await screen.findByText('3% of people in this group are in a test; 97% are free.')).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Tests in this group' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Tests using this space' })).toBeTruthy()
  expect(screen.getByText('See which tests use this group and how much room is left.')).toBeTruthy()
  expect(screen.getByText('Header · Running · 2%')).toBeTruthy()
  expect(screen.getByText('Donation · Decided · 1%')).toBeTruthy()
})
const field = { name: 'usage', type: 'ui', label: 'Tests using this space', admin: { description: 'See which tests use this group and how much room is left.' } } as const
function expectHelp() {
  expect(screen.getByRole('heading', { name: field.label })).toBeTruthy()
  expect(screen.getByText(field.admin.description)).toBeTruthy()
  expect(screen.queryByText(/% of people in this group/)).toBeNull()
}
test.each([undefined, null])('shows label and help on create (%s)', id => {
  setDocumentInfo({ id })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(<LayerUsage path="usage" field={field} />)
  expectHelp()
  expect(fetcher).not.toHaveBeenCalled()
})
test('shows label and help while usage is loading', () => {
  setDocumentInfo({ id: 1 })
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  render(<LayerUsage path="usage" field={field} />)
  expectHelp()
})
test('shows label and help after a usage request fails', async () => {
  setDocumentInfo({ id: 1 })
  const fetcher = vi.fn(async () => ({ ok: false, status: 403 }))
  vi.stubGlobal('fetch', fetcher)
  const { act } = await import('@testing-library/react')
  await act(async () => { render(<LayerUsage path="usage" field={field} />) })
  expectHelp()
})

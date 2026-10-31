// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { SummaryCell } from '../../../src/admin/SummaryCell.js'
import { resetPayloadUiMock } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals() })
const props = { cellData: undefined, collectionSlug: 'xp-experiments', field: { name: 'listSummary', type: 'ui' as const, admin: {} } }
test('renders formatted exposure count, days, and the short verdict label; cells share a request', async () => {
  const entry = { exposures: 12345, days: 14, verdict: { code: 'winner', headline: 'Do not render this headline' } }
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ a: entry, b: entry })))
  vi.stubGlobal('fetch', fetcher)
  render(<><SummaryCell {...props} rowData={{ id: 'a' }} /><SummaryCell {...props} rowData={{ id: 'b' }} /></>)
  await waitFor(() => expect(screen.getAllByText('12,345 exposures · 14 days · A winner')).toHaveLength(2))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Do not render this headline')).toBeNull()
})
test('null entry renders a dash', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetcher)
  await act(async () => { render(<SummaryCell {...props} rowData={{ id: 'missing' }} />) })
  expect(screen.getByText('—')).toBeTruthy()
})
test.each([[1, 1, '1 exposure · 1 day'], [1, 2, '1 exposure · 2 days'], [2, 1, '2 exposures · 1 day'], [0, 0, '0 exposures · 0 days']])('plural handling for %s exposures over %s days', async (exposures, days, text) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ singular: { exposures, days, verdict: null } }))))
  render(<SummaryCell {...props} rowData={{ id: 'singular' }} />)
  expect(await screen.findByText(`${text} · —`)).toBeTruthy()
})
test('changing the row hides an old value and a late response cannot replace the new row', async () => {
  let first!: (response: Response) => void
  const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>(resolve => { first = resolve }))
    .mockResolvedValue(new Response(JSON.stringify({ b: { exposures: 2, days: 3, verdict: null } })))
  vi.stubGlobal('fetch', fetcher)
  const { rerender } = render(<SummaryCell {...props} rowData={{ id: 'a' }} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  rerender(<SummaryCell {...props} rowData={{ id: 'b' }} />)
  await screen.findByText('2 exposures · 3 days · —')
  await act(async () => { first(new Response(JSON.stringify({ a: { exposures: 999, days: 9, verdict: null } }))) })
  expect(screen.getByText('2 exposures · 3 days · —')).toBeTruthy()
})

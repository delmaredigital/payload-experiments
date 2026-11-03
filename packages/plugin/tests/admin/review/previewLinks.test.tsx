// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PreviewLinks } from '../../../src/admin/PreviewLinks.js'
import type { PreflightResult } from '../../../src/types/endpoints.js'
import { resetPayloadUiMock } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const arms = [{ key: 'control', kind: 'control' }, { key: 'variantA', label: 'Short headline', kind: 'variant' }, { key: 'holdout', kind: 'holdout' }]
const placements = [{ collection: 'pages', id: 1, title: 'Home', url: '/home?campaign=fall#top', ok: true }]
test('fetches a token on click, preserves query/hash, opens safely; no token in DOM or storage', async () => {
  const token = 'secret-preview-token'
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token })))
  vi.stubGlobal('fetch', fetcher)
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  const local = vi.fn(), session = vi.fn()
  vi.stubGlobal('localStorage', { setItem: local })
  vi.stubGlobal('sessionStorage', { setItem: session })
  render(<PreviewLinks experimentId="xp1" placements={placements} arms={arms} />)
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /Holdout/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Preview Short headline' }))
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/xp/experiments/xp1/preview-token?arm=variantA')
  expect(open).toHaveBeenCalledWith(`${window.location.origin}/home?campaign=fall&xp_preview=${token}#top`, '_blank', 'noopener,noreferrer')
  expect(document.documentElement.outerHTML).not.toContain(token)
  expect(storage).not.toHaveBeenCalled()
  expect(local).not.toHaveBeenCalled()
  expect(session).not.toHaveBeenCalled()
})
test('no placement url shows a disabled explanation', () => {
  render(<PreviewLinks experimentId={1} placements={[{ collection: 'settings', id: 2, title: 'Ask', ok: true }]} arms={arms} />)
  expect((screen.getByRole('button', { name: "Preview isn't set up for this page type" }) as HTMLButtonElement).disabled).toBe(true)
})
test('one control/variant preview per page; no holdout even without kind', () => {
  render(<PreviewLinks experimentId={1} placements={[...placements, { ...placements[0]!, id: 2, title: 'About', url: '/about' }]} arms={[{ key: 'control' }, { key: 'variantA' }, { key: 'holdout' }]} />)
  expect(screen.getAllByRole('button', { name: 'Preview Original' })).toHaveLength(2)
  expect(screen.getAllByRole('button', { name: 'Preview Variant A' })).toHaveLength(2)
  expect(screen.getAllByRole('button')).toHaveLength(4)
})
test('published and draft placements on the same page render one row and one set of previews without duplicate keys', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const duplicates: PreflightResult['placements'] = [
    { collection: 'pages', id: 31, title: 'Thank you for registering', url: '/thank-you', ok: true, detail: 'Published',
      slots: { control: 1, variantA: 1, variantB: 0, variantC: 0 } },
    { collection: 'pages', id: 31, title: 'Draft thank you', url: '/thank-you', ok: false, detail: 'Draft',
      slots: { control: 2, variantA: 0, variantB: 0, variantC: 0 } },
  ]
  const { container } = render(<PreviewLinks experimentId={1} placements={duplicates} arms={arms} />)
  expect(errors.mock.calls.some(call => call.some(value => String(value).includes('same key')))).toBe(false)
  expect(container.querySelectorAll('.xp-preview-links > div')).toHaveLength(1)
  expect(screen.getByText('Thank you for registering')).toBeTruthy()
  expect(screen.queryByText(/placed/i)).toBeNull()
  expect(screen.queryByText(/Draft thank you/)).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Preview Original' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: 'Preview Short headline' })).toHaveLength(1)
  expect(screen.getAllByRole('button')).toHaveLength(2)
})
test('two placements on one page keep the available URL and show the placement count', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'temporary' }))))
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const duplicates: PreflightResult['placements'] = [
    { collection: 'pages', id: 1, title: 'Home', ok: true, slots: { control: 1, variantA: 1, variantB: 0, variantC: 0 } },
    { collection: 'pages', id: 1, title: 'Home', url: '/home', ok: true, slots: { control: 2, variantA: 1, variantB: 0, variantC: 0 } },
  ]
  const { container } = render(<PreviewLinks experimentId={1} placements={duplicates} arms={arms} />)
  expect(container.querySelectorAll('.xp-preview-links > div')).toHaveLength(1)
  expect(screen.getByText('Home (placed 2 times on this page)')).toBeTruthy()
  expect(screen.getAllByRole('button')).toHaveLength(2)
  expect(screen.queryByRole('button', { name: "Preview isn't set up for this page type" })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Preview Original' }))
  await waitFor(() => expect(open).toHaveBeenCalledWith(`${window.location.origin}/home?xp_preview=temporary`, '_blank', 'noopener,noreferrer'))
})
test('rapid clicks share the in-flight guard and all controls disable until the response', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn().mockReturnValue(new Promise<Response>(done => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  render(<PreviewLinks experimentId={1} placements={placements} arms={arms} />)
  const buttons = screen.getAllByRole('button') as HTMLButtonElement[]
  act(() => { buttons[0]!.click(); buttons[1]!.click() })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(buttons.every(button => button.disabled)).toBe(true)
  resolve(new Response(JSON.stringify({ token: 'temporary' })))
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
  expect(buttons.every(button => !button.disabled)).toBe(true)
})

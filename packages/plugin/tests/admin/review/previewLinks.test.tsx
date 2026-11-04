// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PreviewLinks } from '../../../src/admin/PreviewLinks.js'
import { API_MESSAGES } from '../../../src/admin/copy/common.js'
import { REVIEW_COPY } from '../../../src/admin/copy/review.js'
import type { PreflightResult } from '../../../src/types/endpoints.js'
import { resetPayloadUiMock } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const arms = [{ key: 'control', kind: 'control' }, { key: 'variantA', label: 'Short headline', kind: 'variant' }, { key: 'holdout', kind: 'holdout' }]
const placements = [{ collection: 'pages', id: 1, title: 'Home', url: '/home?campaign=fall#top', ok: true }]
function previewWindow() {
  const win = { opener: window as Window | null, location: { replace: vi.fn() }, close: vi.fn() }
  const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  return { win, open }
}
test('fetches a token on click, preserves query/hash, opens safely; no token in DOM or storage', async () => {
  const token = 'secret-preview-token'
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token })))
  vi.stubGlobal('fetch', fetcher)
  const { win, open } = previewWindow()
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  const local = vi.fn(), session = vi.fn()
  vi.stubGlobal('localStorage', { setItem: local })
  vi.stubGlobal('sessionStorage', { setItem: session })
  render(<PreviewLinks experimentId="xp1" placements={placements} arms={arms} />)
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /Holdout/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Preview Short headline' }))
  expect(open).toHaveBeenCalledWith('', '_blank')
  expect(win.opener).toBeNull()
  await waitFor(() => expect(win.location.replace).toHaveBeenCalledWith(`${window.location.origin}/home?campaign=fall&xp_preview=${token}#top`))
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/xp/experiments/xp1/preview-token?arm=variantA')
  expect(win.close).not.toHaveBeenCalled()
  expect(document.documentElement.outerHTML).not.toContain(token)
  expect(storage).not.toHaveBeenCalled()
  expect(local).not.toHaveBeenCalled()
  expect(session).not.toHaveBeenCalled()
})
test('opens synchronously inside the click before requesting or resolving the token', async () => {
  let resolve!: (response: Response) => void
  const { win, open } = previewWindow()
  const order: string[] = []
  open.mockImplementation(() => { order.push('open'); return win as unknown as Window })
  const fetcher = vi.fn(() => {
    order.push('token request')
    expect(win.opener).toBeNull()
    return new Promise<Response>(done => { resolve = done })
  })
  vi.stubGlobal('fetch', fetcher)
  render(<PreviewLinks experimentId={1} placements={placements} arms={arms} />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview Original' }))
  order.push('click returned')
  expect(order).toEqual(['open', 'token request', 'click returned'])
  expect(open).toHaveBeenCalledExactlyOnceWith('', '_blank')
  expect(win.location.replace).not.toHaveBeenCalled()
  await act(async () => { resolve(new Response(JSON.stringify({ token: 'temporary' }))) })
  expect(win.location.replace).toHaveBeenCalledTimes(1)
})
test('a blocked window shows actionable copy without requesting a token and allows retry', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'temporary' })))
  vi.stubGlobal('fetch', fetcher)
  const { win, open } = previewWindow()
  open.mockReturnValueOnce(null)
  render(<PreviewLinks experimentId={1} placements={placements} arms={arms} />)
  const button = screen.getByRole('button', { name: 'Preview Original' }) as HTMLButtonElement
  fireEvent.click(button)
  expect(screen.getByRole('alert').textContent).toBe(REVIEW_COPY.previewBlocked)
  expect(fetcher).not.toHaveBeenCalled()
  expect(button.disabled).toBe(false)
  fireEvent.click(button)
  await waitFor(() => expect(win.location.replace).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('alert')).toBeNull()
})
test.each([
  [403, 'forbidden', API_MESSAGES.forbidden],
  [404, 'not-found', API_MESSAGES.notFound],
  [409, 'invalid-status', API_MESSAGES.failed],
  [500, 'unknown-code', API_MESSAGES.failed],
])('a refused token (%s) closes the window and shows mapped copy', async (status, code, message) => {
  const serverText = 'private server error details'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ code, message: serverText }] }), { status })))
  const { win } = previewWindow()
  render(<PreviewLinks experimentId={1} placements={placements} arms={arms} />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview Original' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message))
  expect(win.close).toHaveBeenCalledTimes(1)
  expect(win.location.replace).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toContain(serverText)
})
test.each(['not json', 'null', '{}', '{"token":""}', '{"token":123}'])('unreadable token data (%s) closes the window', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
  const { win } = previewWindow()
  render(<PreviewLinks experimentId={1} placements={placements} arms={arms} />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview Original' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(API_MESSAGES.unreadable))
  expect(win.close).toHaveBeenCalledTimes(1)
  expect(win.location.replace).not.toHaveBeenCalled()
})
test('a thrown token request closes the window and shows network copy without error details', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private connection details')))
  const { win } = previewWindow()
  render(<PreviewLinks experimentId={1} placements={placements} arms={arms} />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview Original' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(API_MESSAGES.network))
  expect(win.close).toHaveBeenCalledTimes(1)
  expect(win.location.replace).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toContain('private connection details')
})
test('a navigation throw closes the window and shows existing failure copy', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'temporary' }))))
  const { win } = previewWindow()
  win.location.replace.mockImplementation(() => { throw new Error('private navigation details') })
  render(<PreviewLinks experimentId={1} placements={placements} arms={arms} />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview Original' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(API_MESSAGES.failed))
  expect(win.close).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).not.toContain('private navigation details')
})
test('a browser refusing the opener assignment can still navigate the preview', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'temporary' }))))
  const { win } = previewWindow()
  const setOpener = vi.fn(() => { throw new Error('opener is read-only') })
  Object.defineProperty(win, 'opener', { set: setOpener })
  render(<PreviewLinks experimentId={1} placements={placements} arms={arms} />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview Original' }))
  expect(setOpener).toHaveBeenCalledWith(null)
  await waitFor(() => expect(win.location.replace).toHaveBeenCalledTimes(1))
  expect(win.close).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()
})
test('no preview URL offers Edit on page only and hides rows without either link', () => {
  render(<PreviewLinks experimentId={1} placements={[{ collection: 'pages', id: 2, title: 'Ask', editorUrl: '/editor/2', ok: true }, { collection: 'pages', id: 3, title: 'No links', ok: true }]} arms={arms} />)
  expect(screen.getByRole('link', { name: 'Edit on page' }).getAttribute('href')).toBe('/editor/2')
  expect(screen.queryByText(/Preview isn't set up/)).toBeNull()
  expect(screen.queryByText('No links')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
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
  const { win } = previewWindow()
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
  await waitFor(() => expect(win.location.replace).toHaveBeenCalledWith(`${window.location.origin}/home?xp_preview=temporary`))
})
test('rapid clicks share the in-flight guard and all controls disable until the response', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn().mockReturnValue(new Promise<Response>(done => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  const { win, open } = previewWindow()
  render(<PreviewLinks experimentId={1} placements={placements} arms={arms} />)
  const buttons = screen.getAllByRole('button') as HTMLButtonElement[]
  act(() => { buttons[0]!.click(); buttons[1]!.click() })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(open).toHaveBeenCalledExactlyOnceWith('', '_blank')
  expect(buttons.every(button => button.disabled)).toBe(true)
  resolve(new Response(JSON.stringify({ token: 'temporary' })))
  await waitFor(() => expect(win.location.replace).toHaveBeenCalledTimes(1))
  expect(open).toHaveBeenCalledTimes(1)
  expect(buttons.every(button => !button.disabled)).toBe(true)
})

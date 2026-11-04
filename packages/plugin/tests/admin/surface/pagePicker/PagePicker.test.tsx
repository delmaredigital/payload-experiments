// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PagePicker } from '../../../../src/admin/surface/pagePicker/PagePicker.js'
import { props } from '../readiness/fixtures.js'
vi.mock('@payloadcms/ui', async () => (await import('../../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
const collection = { slug: 'pages', label: 'Pages', contentChecks: true }
const row = (id: number, path: string | null, title = `Page ${id}`) => ({ id, path, pathKey: path?.replace(/\/$/, '') ?? null, title, published: false })
const response = (docs: ReturnType<typeof row>[], more = false) => new Response(JSON.stringify({ docs, hasNextPage: more }))
const deferred = () => { let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done }); return { promise, resolve } }
function setup() {
  const p = props({ kind: 'page' })
  const view = render(<PagePicker collection={collection} test={p.test} armKey="variantA" apiRoute="/data" />)
  return { ...view, p }
}
test('fetches on each opening, shows draft titles and paths, and saves the raw path through the session', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([row(1, '/copy/')]))
  vi.stubGlobal('fetch', fetcher)
  const first = setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Page 1 /copy/ · Draft' }))
  expect(first.p.test.choosePage).toHaveBeenCalledWith('variantA', { id: 1, path: '/copy/' })
  first.unmount(); setup()
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(fetcher.mock.calls[0]![0]).toBe('/data/xp/pages?collection=pages&page=1')
})
test('focus replaces a stale list; a late older response is ignored and aborted', async () => {
  const old = deferred()
  const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response([row(2, '/new')]))
  vi.stubGlobal('fetch', fetcher); setup()
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  fireEvent.focus(window)
  await screen.findByRole('button', { name: /Page 2/ })
  expect((fetcher.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(true)
  await act(async () => old.resolve(response([row(1, '/old')])))
  expect(screen.queryByRole('button', { name: /Page 1/ })).toBeNull()
  fetcher.mockResolvedValueOnce(response([row(3, '/newest')]))
  fireEvent(document, new Event('visibilitychange'))
  await screen.findByRole('button', { name: /Page 3/ })
  expect(screen.queryByRole('button', { name: /Page 2/ })).toBeNull()
})
test('debounces title searches, preserves server order, paginates with More and refreshes the current query', async () => {
  const fetcher = vi.fn().mockImplementation(async (url: string) => response(url.includes('page=2') ? [row(3, '/third')] : [row(2, '/second'), row(1, '/first')], !url.includes('page=2')))
  vi.stubGlobal('fetch', fetcher); setup()
  await screen.findByRole('button', { name: 'More' })
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Page 2 /second · Draft', 'Page 1 /first · Draft'])
  vi.useFakeTimers()
  fireEvent.change(screen.getByLabelText('Search pages by title'), { target: { value: 'copy' } })
  expect(fetcher).toHaveBeenCalledOnce()
  await act(async () => vi.advanceTimersByTime(250))
  vi.useRealTimers()
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(fetcher.mock.calls[1]![0]).toContain('q=copy&page=1')
  fireEvent.click(screen.getByRole('button', { name: 'More' }))
  await screen.findByRole('button', { name: /Page 3/ })
  fireEvent.focus(window)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4))
  expect(fetcher.mock.calls[3]![0]).toContain('q=copy&page=2')
})
test('missing addresses are disabled and request failures have a retry', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 500 })).mockResolvedValueOnce(response([row(1, null)]))
  vi.stubGlobal('fetch', fetcher); setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  const button = await screen.findByRole('button', { name: 'Page 1 · Draft' })
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('This page has no address yet.')).toBeTruthy()
})

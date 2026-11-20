// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DeleteImpactResult } from '../../../../src/types/endpoints.js'
import { DeleteTest, DELETE_IMPACT_TIMEOUT_MS } from '../../../../src/testSurface/surface/test/DeleteTest.js'
import { DELETE_TEST } from '../../../../src/testSurface/copy/testPage.js'
import { API_MESSAGES } from '../../../../src/testSurface/copy/common.js'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ effect: 'none' })))
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
const base = { test: { id: 42, name: 'Welcome test', status: 'draft', kind: 'block' as const }, canManage: true, apiRoute: '/data', onDeleted: vi.fn() }
test.each(['draft', 'archived', 'running', 'stopped', 'decided'])('delete mirrors the guard in %s', status => {
  render(<DeleteTest {...base} test={{ ...base.test, status }} />)
  expect(Boolean(screen.queryByRole('button', { name: 'Delete test' }))).toBe(['draft', 'archived'].includes(status))
})
test('readers never see delete', () => {
  render(<DeleteTest {...base} canManage={false} />)
  expect(screen.queryByRole('button')).toBeNull()
})
test('confirmation names the test and its consequences; cancel deletes nothing and returns focus', () => {
  const fetch = vi.fn(async () => Response.json({ effect: 'none' })); vi.stubGlobal('fetch', fetch)
  render(<DeleteTest {...base} />)
  const trigger = screen.getByRole('button', { name: 'Delete test' }); trigger.focus(); fireEvent.click(trigger)
  expect(screen.getByRole('dialog').textContent).toContain('Welcome test')
  expect(screen.getByRole('dialog').textContent).toContain('results')
  expect(screen.getByRole('dialog').textContent).toContain('page content')
  expect(screen.getByRole('dialog').textContent).toContain('was deleted')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledWith('/data/xp/experiments/42/delete-impact', expect.objectContaining({ method: 'GET' }))
  expect(document.activeElement).toBe(trigger)
})
test.each([200, 404])('confirmed delete handles HTTP %s and reports completion', async status => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'DELETE' ? new Response('{}', { status }) : Response.json({ effect: 'none' })))
  const onDeleted = vi.fn()
  render(<DeleteTest {...base} onDeleted={onDeleted} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', { name: 'Delete test' }).disabled).toBe(false))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete test' }))
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(status === 404 ? 'already' : 'done'))
  expect(fetch).toHaveBeenCalledWith('/data/xp-experiments/42', expect.objectContaining({ method: 'DELETE', credentials: 'include' }))
})
test('server refusal stays visible in the confirmation', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method !== 'DELETE' ? Response.json({ effect: 'none' }) : new Response(JSON.stringify({ errors: [{ code: 'invalid-status', message: 'This action is not available in the current status.' }] }), { status: 409 })))
  const onDeleted = vi.fn()
  render(<DeleteTest {...base} onDeleted={onDeleted} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', { name: 'Delete test' }).disabled).toBe(false))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete test' }))
  expect((await screen.findByRole('alert')).textContent).toBe(API_MESSAGES.deleteInvalidStatus)
  expect(onDeleted).not.toHaveBeenCalled()
})


function openWithImpact(impact: DeleteImpactResult) {
  const fetch = vi.fn(async () => Response.json(impact)); vi.stubGlobal('fetch', fetch)
  render(<DeleteTest {...base} test={{ ...base.test, status: 'archived' }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  return fetch
}
const place = (id: number) => ({ collection: 'pages', id, title: `Page ${id}`, path: `/page-${id}`,
  before: { key: 'variantA', label: 'New welcome' }, after: { key: 'control', label: 'Original' } })
test('lists live pages and the version before and after delete, capped at five with a remaining count', async () => {
  openWithImpact({ effect: 'block', controlLabel: 'Original', pageCount: 8, unreadablePages: 0, placements: Array.from({ length: 8 }, (_, i) => place(i)) })
  await screen.findByText(DELETE_TEST.blockWinner('Original'))
  const rows = within(screen.getByRole('dialog')).getAllByRole('listitem')
  expect(rows).toHaveLength(5)
  expect(rows[0]!.textContent).toContain('Page 0 (/page-0)')
  expect(rows[0]!.textContent).toContain('New welcome → Original')
  expect(screen.getByRole('dialog').textContent).toContain('3 more pages')
  expect(screen.queryByText('Page 5 (/page-5)')).toBeNull()
})
test('page consequences list the current redirected addresses and winner', async () => {
  openWithImpact({ effect: 'page', winnerPath: '/new', addresses: ['/original', '/other'] })
  await screen.findByText(DELETE_TEST.pageWinner)
  expect(within(screen.getByRole('dialog')).getAllByRole('listitem').map(item => item.textContent)).toEqual([
    '/original: /new → /original', '/other: /new → /other',
  ])
})
test('page address lists are capped too', async () => {
  openWithImpact({ effect: 'page', winnerPath: '/new', addresses: Array.from({ length: 12 }, (_, i) => `/page-${i}`) })
  await screen.findByText(DELETE_TEST.pageWinner)
  expect(within(screen.getByRole('dialog')).getAllByRole('listitem')).toHaveLength(5)
  expect(screen.getByRole('dialog').textContent).toContain('7 more pages')
})
test('explicit no effect comes from the read even for an archived test', async () => {
  openWithImpact({ effect: 'none' })
  await screen.findByText(DELETE_TEST.noEffect)
  expect(screen.queryByText(DELETE_TEST.blockWinner('Original'))).toBeNull()
  expect(screen.queryByText(DELETE_TEST.pageWinner)).toBeNull()
})
test('loading blocks delete and does not show unchecked consequences', async () => {
  let settle!: (response: Response) => void
  const fetch = vi.fn(() => new Promise<Response>(resolve => { settle = resolve })); vi.stubGlobal('fetch', fetch)
  render(<DeleteTest {...base} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  expect(screen.getByRole('status').textContent).toBe(DELETE_TEST.checking)
  const button = within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', { name: 'Delete test' })
  expect(button.disabled).toBe(true)
  fireEvent.click(button); expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.queryByText(DELETE_TEST.noEffect)).toBeNull()
  settle(Response.json({ effect: 'none' }))
  await waitFor(() => expect(button.disabled).toBe(false))
})
test.each(['network', 'server', 'empty'] as const)('failed impact read (%s) is plain and still allows independent deletion', async failure => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return Response.json({})
    if (failure === 'network') throw new Error('offline')
    return failure === 'empty' ? new Response(null, { status: 200 }) : Response.json({ errors: [{ message: 'SECRET readability failure' }] }, { status: 500 })
  }); vi.stubGlobal('fetch', fetch)
  const onDeleted = vi.fn()
  render(<DeleteTest {...base} onDeleted={onDeleted} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  await screen.findByText(DELETE_TEST.checkFailed)
  expect(screen.getByRole('dialog').textContent).not.toContain('SECRET')
  expect(screen.queryByRole('list')).toBeNull()
  const button = within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', { name: 'Delete test' })
  expect(button.disabled).toBe(false)
  fireEvent.click(button)
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('done'))
  expect(fetch).toHaveBeenCalledWith('/data/xp-experiments/42', expect.objectContaining({ method: 'DELETE' }))
})
test('reopening fetches current impact and ignores a closed dialog’s old read', async () => {
  let first!: (response: Response) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { first = resolve }))
    .mockResolvedValueOnce(Response.json({ effect: 'none' })); vi.stubGlobal('fetch', fetch)
  render(<DeleteTest {...base} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  await screen.findByText(DELETE_TEST.noEffect)
  first(Response.json({ effect: 'block', controlLabel: 'Original', pageCount: 8, unreadablePages: 0, placements: [place(1)] }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(screen.queryByText(DELETE_TEST.blockWinner('Original'))).toBeNull()
})
test('busy delete retains focus and suppresses duplicate requests', async () => {
  let resolve!: (response: Response) => void
  const fetch = vi.fn((_url: string, init?: RequestInit) => init?.method === 'DELETE' ? new Promise<Response>(done => { resolve = done }) : Promise.resolve(Response.json({ effect: 'none' }))); vi.stubGlobal('fetch', fetch)
  render(<DeleteTest {...base} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  const button = within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', { name: 'Delete test' })
  await waitFor(() => expect(button.disabled).toBe(false))
  button.focus(); fireEvent.click(button)
  expect(button.disabled).toBe(false); expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(button.getAttribute('aria-busy')).toBe('true'); expect(document.activeElement).toBe(button)
  fireEvent.click(button); expect(fetch).toHaveBeenCalledTimes(2)
  resolve(Response.json({})); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('stalled impact reads time out, enable deletion and ignore a late response', async () => {
  vi.useFakeTimers()
  let settle!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { settle = resolve })))
  render(<DeleteTest {...base} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(DELETE_IMPACT_TIMEOUT_MS) })
  expect(screen.getByText(DELETE_TEST.checkFailed)).toBeTruthy()
  expect(within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', { name: 'Delete test' }).disabled).toBe(false)
  await act(async () => { settle(Response.json({ effect: 'none' })) })
  expect(screen.queryByText(DELETE_TEST.noEffect)).toBeNull()
})
test.each([
  [{ effect: 'none' }, DELETE_TEST.noEffect],
  [{ effect: 'block', controlLabel: 'Current hero', pageCount: 3, unreadablePages: 2, placements: [{ ...place(1), after: { key: 'control', label: 'Current hero' } }] }, '3 pages will change'],
] as const)('one mounted live region announces the settled result %j', async (impact, summary) => {
  let settle!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { settle = resolve })))
  render(<DeleteTest {...base} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  const status = screen.getByRole('status')
  await act(async () => { settle(Response.json(impact)) })
  expect(screen.getByRole('status')).toBe(status)
  expect(status.textContent).toBe(summary)
  if (impact.effect === 'block') {
    expect(screen.getByRole('dialog').textContent).toContain("You can't open 2 of these pages.")
    expect(screen.getByRole('dialog').textContent).toContain('Current hero')
    expect(screen.getByRole('dialog').textContent).toContain('site right now')
    expect(screen.getByRole('dialog').textContent).not.toContain('see the Original again')
  }
})
test('the same live region announces a failed check', async () => {
  let settle!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { settle = resolve })))
  render(<DeleteTest {...base} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  const status = screen.getByRole('status')
  await act(async () => { settle(Response.json({}, { status: 422 })) })
  expect(screen.getByRole('status')).toBe(status)
  expect(status.textContent).toBe(DELETE_TEST.checkFailed)
})

test('page rows show another archived route when deleting reveals it', async () => {
  openWithImpact({ effect: 'page', winnerPath: '/new', addresses: ['/original'], afterPaths: { '/original': '/older' } })
  await screen.findByText('/original: /new → /older')
})

test.each([[0, 2], [2, 1], [8, 2]])('details order with %s readable and %s unreadable pages', async (readable, unreadable) => {
  openWithImpact({ effect: 'block', controlLabel: 'Original', pageCount: readable + unreadable, unreadablePages: unreadable,
    placements: Array.from({ length: readable }, (_, i) => ({ ...place(i), locales: ['en', 'fr'] })) })
  await screen.findByText(DELETE_TEST.unreadablePages(unreadable, readable + unreadable))
  const dialog = screen.getByRole('dialog')
  const text = dialog.textContent!
  expect(text).toContain(`${readable + unreadable} pages will change`)
  expect(Boolean(within(dialog).queryByRole('list'))).toBe(readable > 0)
  expect(text.includes('site right now')).toBe(readable > 0)
  if (!readable) expect(screen.queryByText(DELETE_TEST.blockWinner('Original'))).toBeNull()
  if (readable) {
    expect(text).toContain('Languages: en, fr')
    expect(text.indexOf('Page 0')).toBeLessThan(text.indexOf(DELETE_TEST.unreadablePages(unreadable, readable + unreadable)))
  }
  if (readable > 5) {
    expect(text.indexOf('Page 4')).toBeLessThan(text.indexOf('3 more pages.'))
    expect(text.indexOf('3 more pages.')).toBeLessThan(text.indexOf(DELETE_TEST.unreadablePages(unreadable, readable + unreadable)))
  }
})


test.each([
  [1, 1, "You can't open this page."],
  [3, 3, "You can't open any of these pages."],
  [3, 1, "You can't open 1 of these pages."],
  [4, 2, "You can't open 2 of these pages."],
])('natural unreadable-page copy for %s total / %s unreadable', async (pageCount, unreadablePages, sentence) => {
  openWithImpact({ effect: 'block', controlLabel: 'Original', pageCount, unreadablePages, placements: [] })
  await screen.findByText(sentence)
  expect(screen.getByRole('status').textContent).toBe(`${pageCount} ${pageCount === 1 ? 'page' : 'pages'} will change`)
})

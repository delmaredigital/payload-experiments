// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useTestDocument } from '../../../../src/admin/surface/useTestDocument.js'
import { VersionContent } from '../../../../src/admin/surface/test/pageParts.js'
import type { TestDocument } from '../../../../src/admin/surface/testDocument.model.js'
import { props, preflight } from '../readiness/fixtures.js'
vi.mock('@payloadcms/ui', async () => (await import('../../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const deferred = () => { let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done }); return { promise, resolve } }
const surface = { ...props().surface, apiRoute: '/data', pageCollections: [
  { slug: 'pages', label: 'Pages', contentChecks: true, copyUrl: '/tree' },
  { slug: 'articles', label: 'Articles', contentChecks: true, copyUrl: '/articles' },
] }
function Session() {
  const test = useTestDocument('xp1', { apiRoute: '/data' })
  if (!test.doc) return null
  return <><VersionContent test={test} surface={surface} armIndex={1} />
    <button onClick={() => void test.reload()}>Reload session</button>
    <button onClick={() => { test.stage({ pageCollection: 'articles' }); void test.commit() }}>Articles</button>
    <output data-testid="remembered">{Object.keys(test.chosenPages).length}</output>
    <output data-testid="stale">{String(test.stale)}</output>
  </>
}
function server({ existing = true, refuse = 0, refreshFails = false } = {}) {
  let stored: TestDocument = { ...props({ kind: 'page', pageCollection: 'pages' }).test.doc!, updatedAt: 'now' }
  if (existing) stored = { ...stored, arms: stored.arms.map(arm => arm.key === 'variantA' ? { ...arm, pageTarget: '/old' } : arm) }
  const patch = deferred()
  let reads = 0
  const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('/xp/pages?')) return response({ docs: url.includes('collection=articles') ? [] : [{ id: 2, title: 'New page', path: '/new', pathKey: '/new', published: true }], hasNextPage: false })
    if (init?.method === 'PATCH') {
      if (refuse) return patch.promise
      const body = JSON.parse(init.body as string) as Partial<TestDocument>
      stored = { ...stored, ...body }
      return response({ doc: stored })
    }
    if (url.endsWith('/preflight')) {
      reads++
      if (refreshFails && reads > 1) return response({}, 500)
      const path = stored.arms[1]!.pageTarget ?? ''
      return response({ ...preflight(), pagePlacements: [{ arm: 'variantA', collection: 'pages', id: path ? path === '/old' ? 1 : 2 : null, path, title: path === '/old' ? 'Old page' : 'Reloaded page', published: Boolean(path) }] })
    }
    return response(stored)
  })
  vi.stubGlobal('fetch', fetcher)
  return { fetcher, patch, stored: () => stored }
}
const input = () => screen.getByRole('combobox') as HTMLInputElement
async function pick() {
  const field = await screen.findByRole('combobox')
  field.focus(); fireEvent.click(field)
  await screen.findByRole('option', { name: /New page/ })
  fireEvent.keyDown(field, { key: 'ArrowDown' }); fireEvent.keyDown(field, { key: 'Enter' })
}
test.each([true, false])('choice appears immediately despite old or no-id preflight and a failed refresh (existing %s)', async existing => {
  const api = server({ existing, refreshFails: true })
  render(<Session />); await pick()
  await waitFor(() => expect(input().value).toBe('New page · /new'))
  expect(api.fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH' && JSON.parse(init.body as string).arms[1].pageTarget === '/new')).toBe(true)
  expect(input().value).not.toContain('Draft')
})
test.each([400, 409])('a %s refusal reverts only a refused save; stale edits retain the pending choice and focus', async status => {
  const api = server({ refuse: status })
  render(<Session />); await pick()
  await waitFor(() => expect(input().readOnly).toBe(true))
  expect(input().disabled).toBe(false)
  expect(document.activeElement).toBe(input())
  expect(input().value).toBe('New page · /new')
  await act(async () => api.patch.resolve(response({ errors: status === 409 ? [{ code: 'stale-edit' }] : [{ data: { errors: [{ path: 'arms.1.pageTarget', message: 'Choose another page.' }] } }] }, status)))
  await waitFor(() => expect(input().readOnly).toBe(false))
  expect(input().value).toBe(status === 400 ? 'Old page · /old' : 'New page · /new')
  if (status === 400) expect(screen.getByRole('alert').textContent).toBe('Choose another page.')
  else expect(screen.getByTestId('stale').textContent).toBe('true')
  expect(document.activeElement).toBe(input())
})
test('reload clears remembered choice and resolves from fresh preflight without an exact-path request', async () => {
  const api = server()
  render(<Session />); await pick()
  await waitFor(() => expect(input().readOnly).toBe(false))
  expect(screen.getByTestId('remembered').textContent).toBe('1')
  expect(input().value).toBe('New page · /new')
  fireEvent.click(screen.getByRole('button', { name: 'Reload session' }))
  await waitFor(() => expect(screen.getByTestId('remembered').textContent).toBe('0'))
  expect(input().value).toBe('Reloaded page · /new')
  expect(api.fetcher.mock.calls.filter(([url]) => url.includes('&path='))).toHaveLength(0)
})
test('collection change clears the remembered row, keeps the path and resolves not found in the new collection', async () => {
  const api = server()
  render(<Session />); await pick()
  await waitFor(() => expect(input().readOnly).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Articles' }))
  await waitFor(() => expect(input().value).toBe("/new isn't in Articles. Choose a page."))
  expect(screen.getByTestId('remembered').textContent).toBe('0')
  expect(api.stored().arms[1]!.pageTarget).toBe('/new')
  expect(api.fetcher.mock.calls.filter(([url]) => url.includes('collection=articles&path=%2Fnew'))).toHaveLength(1)
})

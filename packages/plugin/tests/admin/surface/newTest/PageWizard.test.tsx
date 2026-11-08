// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { NewTest } from '../../../../src/admin/surface/newTest/NewTest.js'
import { PageWizard } from '../../../../src/admin/surface/newTest/PageWizard.js'
import { VersionContent } from '../../../../src/admin/surface/test/pageParts.js'
import { VersionsSection } from '../../../../src/admin/surface/test/VersionsSection.js'
import { pageParts } from '../../../../src/admin/surface/test/pageParts.js'
import type { TestDocument } from '../../../../src/admin/surface/testDocument.model.js'
import { props, preflight } from '../readiness/fixtures.js'
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation.js', () => ({ useRouter: () => ({ push }) }))
vi.mock('@payloadcms/ui', async () => (await import('../../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const collections = [{ slug: 'pages', label: 'Pages', contentChecks: false, copyUrl: '/tree', copyLabel: 'Open tree', copyHint: 'Copy from the page tree.' }]
const surface = { ...props().surface, pageCollections: collections }
const response = (body: unknown) => new Response(JSON.stringify(body))
function server(checks = preflight().checks) {
  let stored: TestDocument = { ...props({ kind: 'page', exposurePolicy: 'pageview', pageCollection: 'pages' }).test.doc!, updatedAt: '2026-11-04', arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 50 }, { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50 },
  ] }
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/xp/pages?')) return response({ docs: [
      { id: 1, title: 'Welcome', path: '/welcome/', pathKey: '/welcome', published: true },
      { id: 2, title: 'Copy', path: '/copy/', pathKey: '/copy', published: false },
    ].filter(row => { const path = new URL(url, 'http://localhost').searchParams.get('path'); return !path || row.path.replace(/\/$/, '') === path.replace(/\/$/, '') }), hasNextPage: false })
    if (url.endsWith('/preflight')) return response(preflight(checks))
    if (init?.method === 'POST' && url.endsWith('/start')) return response({ revision: 1 })
    if (init?.method === 'PATCH') { stored = { ...stored, ...JSON.parse(init.body as string) }; return response({ doc: stored }) }
    if (init?.method === 'POST') { stored = { ...stored, ...JSON.parse(init.body as string) }; return response({ doc: stored }) }
    if (url.includes('where[slug]')) return response({ docs: [] })
    return response(stored)
  })
  vi.stubGlobal('fetch', fetcher)
  return { fetcher, stored: () => stored }
}
async function choose(title: string) {
  fireEvent.click(screen.getByRole('combobox'))
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(title.replace(' /', '.*/')) }))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false))
}
test('Name posts a complete page body via createTest; single collection skips its step and saves page choices across leaving', async () => {
  const api = server()
  const view = render(<NewTest surface={surface} />)
  fireEvent.click(screen.getByRole('button', { name: /A whole page/ }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Whole welcome' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await screen.findByText('Choose the page visitors see today.')
  expect(screen.queryByRole('heading', { name: 'Collection' })).toBeNull()
  const post = api.fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(post[1]!.body as string)).toEqual({ kind: 'page', name: 'Whole welcome', slug: 'whole-welcome', unitType: 'visitor', exposurePolicy: 'pageview', allocation: 100,
    analysis: { plannedDurationDays: 28 }, pageCollection: 'pages', arms: [
      { key: 'control', kind: 'control', label: 'Original', weight: 50 }, { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50 },
    ] })
  await choose('Welcome /welcome/')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'A page for Variant A' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open tree' }).getAttribute('target')).toBe('_blank')
  expect(screen.getByText('Then choose the page you made.')).toBeTruthy()
  await choose('Copy /copy/')
  expect(api.stored().arms[1]!.pageTarget).toBe('/copy/')
  fireEvent.click(screen.getByRole('button', { name: 'Back to the test' }))
  expect(push).toHaveBeenCalledWith('/admin/experiments/xp1')
  view.unmount()
  render(<PageWizard id="xp1" surface={surface} />)
  await screen.findByText('Choose the page visitors see today.')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('heading', { name: 'A page for Variant A' })
  expect(api.stored().arms.map(arm => arm.pageTarget)).toEqual(['/welcome/', '/copy/'])
  // One initial test-document GET in the first wizard; step changes do not remount its session.
  expect(api.fetcher.mock.calls.filter(([url, init]) => url.includes('/xp-experiments/xp1?') && init?.method !== 'PATCH')).toHaveLength(2)
})
test('multiple collections save through the document session and survive a reload', async () => {
  const api = server()
  const two = { ...surface, pageCollections: [...collections, { slug: 'articles', label: 'Articles', contentChecks: true }] }
  const view = render(<PageWizard id="xp1" surface={two} />)
  fireEvent.click(await screen.findByRole('radio', { name: 'Articles' }))
  await waitFor(() => expect(api.stored().pageCollection).toBe('articles'))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false))
  view.unmount(); render(<PageWizard id="xp1" surface={two} />)
  const chosen = await screen.findByRole('radio', { name: 'Articles' })
  expect((chosen as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Choose the page visitors see today.')
  fireEvent.click(screen.getByRole('combobox'))
  await waitFor(() => expect(api.fetcher.mock.calls.some(([url]) => url.includes('collection=articles'))).toBe(true))
})
test.each([false, true])('Review main action reflects readiness (%s); Finish setup jumps to affected version', async ready => {
  const api = server(ready ? [] : [{ code: 'page-no-targets', ok: false }])
  render(<PageWizard id="xp1" surface={surface} />)
  await screen.findByText('Choose the page visitors see today.')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  const button = await screen.findByRole('button', { name: ready ? 'Start' : 'Finish setup' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  expect(api.fetcher.mock.calls.filter(([url]) => url.endsWith('/preflight'))).toHaveLength(2)
  fireEvent.click(button)
  if (ready) await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/experiments/xp1'))
  else {
    expect(screen.getByText('Choose the page visitors see today.')).toBeTruthy()
    fireEvent.click(screen.getByRole('combobox'))
    await screen.findByRole('option', { name: /Welcome/ })
  }
})
test('Review refetches on focus and visibility, and late responses cannot restore a stale refusal', async () => {
  const api = server()
  let resolve!: (value: Response) => void
  const late = new Promise<Response>(done => { resolve = done })
  const initial = api.fetcher.getMockImplementation()!
  let reads = 0
  api.fetcher.mockImplementation(async (url, init) => {
    if (url.endsWith('/preflight')) {
      reads++
      if (reads === 3) return late
      return response(preflight(reads < 4 ? [{ code: 'page-target-unpublished', ok: false, detail: '/copy/' }] : []))
    }
    return initial(url, init)
  })
  render(<PageWizard id="xp1" surface={surface} />)
  await screen.findByText('Choose the page visitors see today.')
  fireEvent.focus(window)
  expect(reads).toBe(1) // picker focus refreshes pages only before Review
  fireEvent.click(screen.getByRole('button', { name: 'Next' })); fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('button', { name: 'Finish setup' })
  fireEvent.focus(window)
  await waitFor(() => expect(reads).toBe(3))
  fireEvent(document, new Event('visibilitychange'))
  expect(reads).toBe(3) // the same return fires focus and visibility
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 150)
  fireEvent(document, new Event('visibilitychange'))
  clock.mockRestore()
  await waitFor(() => expect(reads).toBe(4))
  expect((await screen.findByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(false)
  await act(async () => resolve(response(preflight([{ code: 'page-target-unpublished', ok: false, detail: '/copy/' }]))))
  await screen.findByRole('button', { name: 'Start' })
  expect(screen.queryByText(/isn't published yet/)).toBeNull()
})
test('Versions uses one inline field, exact placement links and sibling variant guidance', async () => {
  server()
  const p = props({ kind: 'page', pageCollection: 'pages', arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/welcome' },
    { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, pageTarget: '/copy/' },
  ] })
  p.surface.pageCollections = collections
  p.test.preflight!.pagePlacements = [{ arm: 'control', path: '/welcome', title: 'Welcome', id: 1, collection: 'pages', published: true, editorUrl: '/edit', url: '/preview' },
    { arm: 'variantA', path: '/copy/', id: null, collection: 'pages', published: false, title: 'Hidden', editorUrl: '/wrong', url: '/wrong-preview' }]
  const view = render(<VersionContent {...p} armIndex={0} />)
  expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Welcome · /welcome')
  expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/edit')
  expect(screen.getByRole('link', { name: 'Preview' }).getAttribute('href')).toBe('/preview')
  fireEvent.click(screen.getByRole('combobox'))
  await screen.findByRole('listbox')
  expect(view.container.querySelector('.xp-copy-route')).toBeNull()
  view.rerender(<VersionContent {...p} armIndex={1} />)
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
  expect(screen.queryByRole('link', { name: 'Open' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Preview' })).toBeNull()
  expect(view.container.querySelector('.xp-copy-route')?.nextElementSibling?.className).toBe('xp-page-combobox')
  expect(view.container.querySelector('.xp-copy-route .xp-page-combobox')).toBeNull()
  await waitFor(() => expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Copy · /copy/ · Draft'))
  view.unmount()
  render(<VersionsSection {...p} parts={pageParts} />)
  expect(screen.getByText('Content checks are off for this page type.')).toBeTruthy()
  expect(document.getElementById('xp-version-variantA')).toBeTruthy()
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Page for Variant A' }) as HTMLInputElement).value).toBe('Copy · /copy/ · Draft'))
})
test.each([undefined, ''])('unchosen page (%s) shows the field placeholder', pageTarget => {
  const p = props({ kind: 'page', pageCollection: 'pages', arms: [{ key: 'variantA', kind: 'variant', label: 'Variant A', weight: 100, pageTarget }] })
  p.surface.pageCollections = collections
  p.test.preflight!.pagePlacements = [{ arm: 'variantA', path: '', id: null, published: false }]
  render(<VersionContent {...p} armIndex={0} />)
  expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('combobox').getAttribute('placeholder')).toBe('Choose a page')
})
test.each(['future-code', 'toString'])('Review tolerates unknown readiness code %s with the home-card fallback', async code => {
  server([{ code, ok: false }] as unknown as ReturnType<typeof preflight>['checks'])
  render(<PageWizard id="xp1" surface={surface} />)
  await screen.findByText('Choose the page visitors see today.')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('Review setup')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
  expect(push).toHaveBeenCalledWith('/admin/experiments/xp1#section-what')
})
test.each([
  [500, "Couldn't load this test."], [403, "You don't have access to this test."], [404, 'This test no longer exists.'],
])('wizard loading shows only status; %s shows its error, retry and back', async (status, sentence) => {
  let resolve!: (value: Response) => void
  const pending = new Promise<Response>(done => { resolve = done })
  const fetcher = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(new Response('{}', { status }))
  vi.stubGlobal('fetch', fetcher)
  render(<PageWizard id="xp1" surface={surface} />)
  expect(screen.getByRole('status').textContent).toBe('Loading test…')
  expect(screen.queryByRole('button')).toBeNull()
  await act(async () => resolve(new Response('{}', { status })))
  expect((await screen.findByRole('alert')).textContent).toBe(sentence)
  expect(screen.queryByText('Loading test…')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: 'Back to the test' }))
  expect(push).toHaveBeenCalledWith('/admin/experiments/xp1')
})
test('existing page tests fall back to server placement collection; unconfigured tests retain the text box', () => {
  const p = props({ kind: 'page', arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 100, pageTarget: '/welcome' }] })
  const view = render(<VersionContent {...p} armIndex={0} />)
  expect(screen.getByLabelText('Original: Page address')).toBeTruthy()
  p.surface.pageCollections = collections
  p.test.preflight!.pagePlacements = [{ arm: 'control', path: '/welcome', id: 1, published: true, collection: 'pages' }]
  view.rerender(<VersionContent {...p} armIndex={0} />)
  expect(screen.queryByLabelText('Original: Page address')).toBeNull()
  expect(screen.getByText('Where it shows')).toBeTruthy()
})

test('reproduction: wizard PATCHes the clicked page and shows the current choice', async () => {
  const api = server()
  render(<PageWizard id="xp1" surface={surface} />)
  await screen.findByText('Choose the page visitors see today.')
  await waitFor(() => expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('combobox'))
  fireEvent.click(await screen.findByRole('option', { name: /Welcome/ }))
  await waitFor(() => expect(api.fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH' && JSON.parse(init.body as string).arms?.[0]?.pageTarget === '/welcome/')).toBe(true))
  expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Welcome · /welcome/')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Welcome · /welcome/')
})
test('reproduction: Versions ignores an old placement after choosing a new page', () => {
  const p = props({ kind: 'page', pageCollection: 'pages', arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 100, pageTarget: '/new' }] })
  p.surface.pageCollections = collections
  p.test.chosenPages = { control: { id: 2, path: '/new' } }
  p.test.preflight!.pagePlacements = [{ arm: 'control', collection: 'pages', id: 1, path: '/old', title: 'Old page', published: true }]
  render(<VersionContent {...p} armIndex={0} />)
  expect(screen.queryByText('Old page · /old')).toBeNull()
  expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('/new')
})

test('wizard shows page-target errors at the document index when Original is reordered first', async () => {
  const api = server()
  const initial = api.fetcher.getMockImplementation()!
  api.fetcher.mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH') return new Response(JSON.stringify({ errors: [{ data: { errors: [{ path: 'arms.1.pageTarget', message: 'Pick a published Original.' }] } }] }), { status: 400 })
    if (url.includes('/xp-experiments/') && init?.method === 'GET') return response({ ...api.stored(), arms: [...api.stored().arms].reverse() })
    return initial(url, init)
  })
  render(<PageWizard id="xp1" surface={surface} />)
  await screen.findByRole('combobox', { name: 'Page for Original' })
  fireEvent.click(screen.getByRole('combobox'))
  fireEvent.click(await screen.findByRole('option', { name: /Welcome/ }))
  expect((await screen.findByText('Pick a published Original.')).getAttribute('role')).toBe('alert')
})

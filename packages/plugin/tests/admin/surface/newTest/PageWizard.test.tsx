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
    ], hasNextPage: false })
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
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(title) }))
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
    await screen.findByRole('button', { name: /Welcome/ })
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
test('test page uses the registered picker with placement links; a no-id entry has only path and Draft', async () => {
  server()
  const p = props({ kind: 'page', pageCollection: 'pages', arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 50, pageTarget: '/welcome' },
    { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, pageTarget: '/copy/' },
  ] })
  p.surface.pageCollections = collections
  p.test.preflight!.pagePlacements = [{ arm: 'control', path: '/welcome', title: 'Welcome', id: 1, collection: 'pages', published: true, editorUrl: '/edit', url: '/preview' },
    { arm: 'variantA', path: '/copy/', id: null, collection: 'pages', published: false, title: 'Hidden', editorUrl: '/wrong', url: '/wrong-preview' }]
  const view = render(<VersionContent {...p} armIndex={0} />)
  expect(screen.getByText('Where it shows')).toBeTruthy()
  expect(screen.getByText('Welcome · /welcome')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/edit')
  expect(screen.getByRole('link', { name: 'Preview' }).getAttribute('href')).toBe('/preview')
  fireEvent.click(screen.getByRole('button', { name: 'Change' }))
  await screen.findByLabelText('Search pages by title')
  expect(screen.queryByText('Copy from the page tree.')).toBeNull()
  expect(screen.queryByText('Then choose the page you made.')).toBeNull()
  expect(view.container.querySelector('.xp-copy-route')).toBeNull()
  view.rerender(<VersionContent {...p} armIndex={1} />)
  expect(screen.getByText('/copy/ · Draft', { selector: 'p' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Open' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Preview' })).toBeNull()
  expect(screen.queryByText('Hidden')).toBeNull()
  expect(screen.getByText('Copy from the page tree.')).toBeTruthy()
  expect(screen.getByText('Then choose the page you made.').nextElementSibling?.className).toBe('xp-page-picker')
  expect(view.container.querySelector('.xp-version-content--page')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByText('Then choose the page you made.')).toBeNull()
  expect(screen.queryByText('Copy from the page tree.')).toBeNull()
  expect(screen.queryByLabelText('Search pages by title')).toBeNull()
  expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy()
  view.unmount()
  render(<VersionsSection {...p} parts={pageParts} />)
  expect(screen.getByText('Content checks are off for this page type.')).toBeTruthy()
  expect(document.getElementById('xp-version-variantA')).toBeTruthy()
})
test.each([undefined, ''])('unchosen page (%s) has authored empty copy, while a chosen path without an id remains Draft', pageTarget => {
  const p = props({ kind: 'page', pageCollection: 'pages', arms: [{ key: 'variantA', kind: 'variant', label: 'Variant A', weight: 100, pageTarget }] })
  p.surface.pageCollections = collections
  p.test.preflight!.pagePlacements = [{ arm: 'variantA', path: '', id: null, published: false }]
  const view = render(<VersionContent {...p} armIndex={0} />)
  expect(screen.getByText('No page chosen yet.')).toBeTruthy()
  expect(screen.queryByText(/Draft/)).toBeNull()
  expect(screen.queryByText('Then choose the page you made.')).toBeNull()
  expect(screen.getByRole('button', { name: 'Choose a page' })).toBeTruthy()
  p.test.doc!.arms[0]!.pageTarget = '/chosen'
  view.rerender(<VersionContent {...p} armIndex={0} />)
  expect(screen.getByText('/chosen · Draft')).toBeTruthy()
  expect(screen.queryByText('No page chosen yet.')).toBeNull()
})
test('a version row shows copy instructions only when open, immediately followed by the picker', async () => {
  server()
  const p = props({ kind: 'page', pageCollection: 'pages', arms: [{ key: 'variantA', kind: 'variant', label: 'Variant A', weight: 100, pageTarget: '/copy' }] })
  p.surface.pageCollections = collections
  p.test.preflight!.pagePlacements = [{ arm: 'variantA', path: '/copy', id: 2, published: true, editorUrl: '/edit-copy', url: '/preview-copy' }]
  render(<VersionContent {...p} armIndex={0} />)
  expect(screen.getByText('Where it shows')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/edit-copy')
  expect(screen.getByRole('link', { name: 'Preview' }).getAttribute('href')).toBe('/preview-copy')
  expect(screen.queryByText('Then choose the page you made.')).toBeNull()
  expect(screen.queryByRole('link', { name: 'Open tree' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Change' }))
  await screen.findByRole('button', { name: /Welcome/ })
  expect(screen.getByRole('link', { name: 'Open tree' })).toBeTruthy()
  expect(screen.getByText('Then choose the page you made.').nextElementSibling?.className).toBe('xp-page-picker')
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

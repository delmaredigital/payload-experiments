// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { SurfaceProps } from '../../../../src/testSurface/surface/contracts.js'
import type { TestsSurfaceProps } from '../../../../src/types/surface.js'
import { NewTest } from '../../../../src/admin/surface/newTest/NewTest.js'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation.js', () => ({ useRouter: () => ({ push }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const surface: SurfaceProps = {
  adminRoute: '/control', apiRoute: '/data', canManage: true, canReadResults: true, isAdmin: false,
  flagPoints: [{ id: 'welcome', label: 'Welcome message', description: 'The greeting people see.', params: {}, defaultParams: {}, effectiveDefaults: {} }],
  metricSources: [], attributeKeys: {}, admin: { descriptions: { block: 'Our page content.', setting: 'Our site choices.' } },
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function settingStep() {
  fireEvent.click(screen.getByRole('button', { name: /A setting/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Welcome message/ }))
}
function nameStep() { settingStep(); fireEvent.click(screen.getByRole('button', { name: 'Next' })) }

test('offers only configured cards with host descriptions, and a useful empty state', () => {
  const view = render(<NewTest surface={surface} />)
  expect(screen.queryByRole('button', { name: /A block on a page/ })).toBeNull()
  expect(screen.getByText('Our site choices.')).toBeTruthy()
  expect(screen.queryByText('A document')).toBeNull()
  view.rerender(<NewTest surface={{ ...surface, flagPoints: [] }} pages={[]} />)
  expect(screen.getByRole('button', { name: /A block on a page/ })).toBeTruthy()
  expect(screen.getByText('Our page content.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /A setting/ })).toBeNull()
  view.rerender(<NewTest surface={{ ...surface, flagPoints: [] }} />)
  expect(screen.getByText('A developer needs to set up pages or settings before you can create a test.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(push).toHaveBeenCalledWith('/control/collections/xp-experiments')
})
test('block hand-off groups page links, marks a full list, and never creates anything', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const pages: NonNullable<TestsSurfaceProps['pages']> = Array.from({ length: 50 }, (_, id) => ({ id, collection: 'pages', editor: 'puck' as const, collectionLabel: 'Pages', title: `Page ${id}`, editorUrl: `/editor/${id}` }))
  pages.push({ id: 'story', collection: 'stories', editor: 'blocks' as const, collectionLabel: 'Stories', title: 'Story', editorUrl: '/stories/story' })
  render(<NewTest surface={surface} pages={pages} />)
  fireEvent.click(screen.getByRole('button', { name: /A block on a page/ }))
  expect(screen.getByText('Open the page, add an Experiment block where you want the test, and choose Test this block.')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Pages' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Stories' })).toBeTruthy()
  expect(screen.getAllByRole('link', { name: 'Open' })).toHaveLength(51)
  expect(screen.getAllByRole('link', { name: 'Open' })[0]!.getAttribute('href')).toBe('/editor/0')
  expect(screen.getAllByText('Showing the 50 most recently edited.')).toHaveLength(1)
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('heading', { name: 'What do you want to test?' })).toBeTruthy()
})
test('an empty page hand-off explains there are no pages', () => {
  render(<NewTest surface={surface} pages={[]} />)
  fireEvent.click(screen.getByRole('button', { name: /A block on a page/ }))
  expect(screen.getByText('There are no pages yet.')).toBeTruthy()
})
test('setting defaults to visitors, names from the setting, preserves answers on Back, and creates a complete body', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response({ doc: { id: 12, slug: 'a-warmer-welcome' } }))
  vi.stubGlobal('fetch', fetch)
  render(<NewTest surface={surface} />)
  settingStep()
  expect(screen.getByText('The greeting people see.')).toBeTruthy()
  expect((screen.getByRole('radio', { name: 'Visitors' }) as HTMLInputElement).checked).toBe(true)
  expect(screen.getByText('Advanced').closest('details')!.open).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.queryByText('Advanced')).toBeNull()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Welcome message')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A warmer welcome' } })
  fireEvent.change(screen.getByLabelText('Why are you testing this? (optional)'), { target: { value: 'More people will respond.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect((screen.getByRole('radio', { name: /Welcome message/ }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('A warmer welcome')
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/control/experiments/12'))
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ name: 'A warmer welcome', slug: 'a-warmer-welcome', kind: 'flag', unitType: 'visitor',
    exposurePolicy: 'manual', flagPoint: 'welcome', hypothesis: 'More people will respond.', arms: [
      { key: 'control', kind: 'control', label: 'Original', weight: 50 }, { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50 },
    ], allocation: 100, analysis: { plannedDurationDays: 28 } })
})
test.each([8, 'group-uuid'])('Advanced preserves the API layer id %s and signed-in choice', async layerId => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [{ id: layerId, name: 'Homepage tests' }] }))
    .mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response({ doc: { id: 'uuid', slug: 'welcome-message' } }))
  vi.stubGlobal('fetch', fetch)
  render(<NewTest surface={{ ...surface, adminRoute: '/' }} />)
  settingStep()
  fireEvent.click(screen.getByRole('radio', { name: 'Signed-in users' }))
  const details = screen.getByText('Advanced').closest('details')!
  details.open = true; fireEvent(details, new Event('toggle'))
  await screen.findByRole('option', { name: 'Homepage tests' })
  expect(fetch.mock.calls[0]![0]).toBe('/data/xp-layers?depth=0&limit=100&page=1')
  fireEvent.change(screen.getByLabelText('Put this test in a group (optional)'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/experiments/uuid'))
  expect(JSON.parse(fetch.mock.calls[2]![1].body)).toMatchObject({ layer: layerId, unitType: 'user' })
})
test('a selected group can be cleared and is then omitted', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [{ id: 8, name: 'Group' }] }))
    .mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response({ doc: { id: 1, slug: 'welcome-message' } }))
  vi.stubGlobal('fetch', fetch)
  render(<NewTest surface={surface} />); settingStep()
  const details = screen.getByText('Advanced').closest('details')!
  details.open = true; fireEvent(details, new Event('toggle'))
  await screen.findByRole('option', { name: 'Group' })
  const picker = screen.getByLabelText('Put this test in a group (optional)')
  fireEvent.change(picker, { target: { value: '0' } }); fireEvent.change(picker, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' })); fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(push).toHaveBeenCalled())
  expect(JSON.parse(fetch.mock.calls[2]![1].body)).not.toHaveProperty('layer')
})
test('refusals stay inline and creation can be tried again', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response({ errors: [{ message: 'The following field is invalid: flagPoint', data: { errors: [{ message: 'Choose another setting.' }] } }] }, 400))
  vi.stubGlobal('fetch', fetch)
  render(<NewTest surface={surface} />); nameStep()
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Choose another setting.')
  expect(push).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(2)
  expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false)
})
test('pending creation disables the controls and blocks a double submit', () => {
  const fetch = vi.fn().mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('fetch', fetch)
  render(<NewTest surface={surface} />); nameStep()
  const create = screen.getByRole('button', { name: 'Create' })
  fireEvent.click(create); fireEvent.submit(create.closest('form')!)
  expect(fetch).toHaveBeenCalledOnce()
  expect((screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
})


test.each(['network', 'json'])('%s failures show generic creation copy without navigating', async failure => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] }))
  if (failure === 'network') fetch.mockRejectedValueOnce(new Error('Failed to fetch'))
  else fetch.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }))
  vi.stubGlobal('fetch', fetch)
  render(<NewTest surface={surface} />); nameStep()
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect((await screen.findByRole('alert')).textContent).toBe("Couldn't create the test. Try again.")
  expect(push).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false)
})

test.each([
  [{ errors: [{ message: 'The following field is invalid: flagPoint' }] }, false, "Couldn't create the test. Try again."],
  [{ errors: [{ message: 'The following field is invalid: slug', data: { errors: [{ path: 'slug', message: 'Value must be unique' }] } }] }, true, 'This name is too close to an existing test. Choose a different name.'],
])('refusals hide the outer Payload field wrapper', async (body, collision, message) => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response(body, 400))
  if (collision) fetch.mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response(body, 400))
  vi.stubGlobal('fetch', fetch)
  render(<NewTest surface={surface} />); nameStep()
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect((await screen.findByRole('alert')).textContent).toBe(message)
  expect(push).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(collision ? 4 : 2)
})

test('Advanced lists all 150 layers across two pages', async () => {
  const layers = Array.from({ length: 150 }, (_, id) => ({ id, name: `Group ${id}` }))
  const fetch = vi.fn(async (url: string) => {
    const page = Number(new URL(url, 'https://example.test').searchParams.get('page'))
    return response({ docs: layers.slice((page - 1) * 100, page * 100), hasNextPage: page < 2 })
  })
  vi.stubGlobal('fetch', fetch)
  render(<NewTest surface={surface} />)
  settingStep()
  const details = screen.getByText('Advanced').closest('details')!
  details.open = true; fireEvent(details, new Event('toggle'))
  await screen.findByRole('option', { name: 'Group 149' })
  expect(screen.getAllByRole('option')).toHaveLength(151)
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('whole-page card is conditional and shows the host example', () => {
  const view = render(<NewTest surface={surface} />)
  expect(screen.queryByRole('button', { name: /A whole page/ })).toBeNull()
  view.rerender(<NewTest surface={{ ...surface, pageCollections: [{ slug: 'pages', label: 'Pages', contentChecks: true }], admin: { descriptions: { page: 'Try a new welcome page.' } } }} />)
  expect(screen.getByRole('button', { name: /A whole page/ }).textContent).toContain('Show different versions of a whole page at the same address, and see which one works better.')
  expect(screen.getByText('Try a new welcome page.')).toBeTruthy()
})
test('blocks handoff includes the legacy editor instruction', () => {
  render(<NewTest surface={surface} pages={[{ collection: 'pages', collectionLabel: 'Pages', editor: 'blocks', id: 1, title: 'Legacy', editorUrl: '/control/collections/pages/1' }]} />)
  fireEvent.click(screen.getByRole('button', { name: /A block on a page/ }))
  expect(screen.getByText("Pick the block to test with 'Test a block on this page'.")).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/control/collections/pages/1')
})

test('returning from Setting never carries a hidden layer into page creation', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ docs: [{ id: 8, name: 'Signed-in group' }] }))
    .mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response({ doc: { id: 1, slug: 'welcome-message' } })).mockResolvedValue(response({}))
  vi.stubGlobal('fetch', fetcher)
  render(<NewTest surface={{ ...surface, pageCollections: [{ slug: 'pages', label: 'Pages', contentChecks: true }] }} />)
  settingStep()
  const details = screen.getByText('Advanced').closest('details')!
  details.open = true; fireEvent(details, new Event('toggle'))
  await screen.findByRole('option', { name: 'Signed-in group' })
  fireEvent.change(screen.getByLabelText('Put this test in a group (optional)'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  fireEvent.click(screen.getByRole('button', { name: /A whole page/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
  const body = JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1].body)
  expect(body).not.toHaveProperty('layer')
  expect(body).toMatchObject({ kind: 'page', unitType: 'visitor', exposurePolicy: 'pageview' })
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CreateExperimentDrawer, openCreateExperimentDrawer } from '../../../src/puck/editor/CreateExperimentDrawer.js'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const collision = { errors: [{ message: 'That slug is already in use.', data: { errors: [{ path: 'slug', message: 'Value must be unique' }] } }] }
function setup(body: unknown = { doc: { id: 42, slug: 'new-test' } }, status = 200) {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response(body, status))
  vi.stubGlobal('fetch', fetch)
  const onCreate = vi.fn().mockReturnValue(true), onClose = vi.fn()
  render(<CreateExperimentDrawer initialName="Page title" onCreate={onCreate} onClose={onClose} />)
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Page title')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New test' } })
  return { fetch, onCreate, onClose }
}
const create = () => fireEvent.click(screen.getByRole('button', { name: 'Test this block' }))
const expectedBody = {
  name: 'New test', slug: 'new-test', kind: 'block', unitType: 'visitor', exposurePolicy: 'render',
  arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 50, slot: 'control' },
    { key: 'variantA', kind: 'variant', label: 'Variant A', weight: 50, slot: 'variantA' }],
  allocation: 100, analysis: { plannedDurationDays: 28 },
}
test('posts the exact complete draft body, without a slug input, and binds the result', async () => {
  const { fetch, onCreate, onClose } = setup()
  expect(screen.queryByLabelText('Slug')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Test this block' })).toBeTruthy()
  expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe(screen.getByRole('heading').id)
  expect(screen.getByRole('dialog').tagName).toBe('DIALOG')
  expect(document.activeElement).toBe(screen.getByLabelText('Name'))
  expect(screen.getByLabelText('Name').classList.contains('xp-ui-input')).toBe(true)
  expect(screen.getByRole('button', { name: 'Test this block' }).classList.contains('xp-ui-button--primary')).toBe(true)
  expect(screen.getByRole('button', { name: 'Cancel' }).classList.contains('xp-ui-button--primary')).toBe(false)
  create()
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ id: 42, slug: 'new-test' }))
  expect(onClose).toHaveBeenCalledOnce()
  const probe = new URL(fetch.mock.calls[0]![0], 'https://example.test')
  expect(probe.searchParams.get('where[slug][in]')?.split(',')).toHaveLength(50)
  expect(probe.searchParams.get('where[slug][in]')?.split(',')[0]).toBe('new-test')
  expect(fetch.mock.calls[0]![1]).toEqual({ credentials: 'include' })
  expect(fetch.mock.calls[1]).toEqual(['/api/xp-experiments', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expectedBody),
  }])
})
test('a collision re-queries and retries once using the next free slug', async () => {
  const { fetch, onCreate } = setup(collision, 400)
  fetch.mockResolvedValueOnce(response({ docs: [{ slug: 'new-test' }, { slug: 'new-test-2' }] }))
    .mockResolvedValueOnce(response({ doc: { id: 43, slug: 'new-test-3' } }))
  create()
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ id: 43, slug: 'new-test-3' }))
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(new URL(fetch.mock.calls[2]![0], 'https://example.test').searchParams.get('where[slug][in]')?.split(',')[0]).toBe('new-test-2')
  expect(JSON.parse(fetch.mock.calls[3]![1].body)).toEqual({ ...expectedBody, slug: 'new-test-3' })
})
test('a second collision stays inline and never retries a third time', async () => {
  const { fetch, onCreate, onClose } = setup(collision, 400)
  fetch.mockResolvedValueOnce(response({ docs: [{ slug: 'new-test' }] })).mockResolvedValueOnce(response(collision, 400))
  create()
  expect((await screen.findByRole('alert')).textContent).toBe('This name is too close to an existing test. Choose a different name.')
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(onCreate).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})
test('other Payload refusals are inline without retrying', async () => {
  const { fetch, onCreate } = setup({ errors: [{ message: 'The following field is invalid: name', data: { errors: [{ message: 'Name is required.' }] } }] }, 400)
  create()
  expect((await screen.findByRole('alert')).textContent).toBe('Name is required.')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(onCreate).not.toHaveBeenCalled()
})
test.each(['network', 'json', 'malformed', 'lookup'])('%s failure stays in the drawer', async mode => {
  const { fetch, onCreate } = setup({ doc: {} })
  if (mode === 'network') fetch.mockReset().mockRejectedValue(new Error('offline'))
  if (mode === 'json') fetch.mockReset().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }))
  if (mode === 'lookup') fetch.mockReset().mockResolvedValue(response({}, 403))
  create()
  expect((await screen.findByRole('alert')).textContent).toBe("Couldn't create the test. Try again.")
  expect(onCreate).not.toHaveBeenCalled()
})
test('pending creation blocks repeated clicks and cancel', async () => {
  const { fetch } = setup()
  fetch.mockReset().mockReturnValue(new Promise(() => {}))
  const button = screen.getByRole('button', { name: 'Test this block' })
  fireEvent.click(button); fireEvent.click(button)
  expect(fetch).toHaveBeenCalledOnce()
  expect((screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
})
test('cancel closes without posting', () => {
  const { fetch, onClose } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
})


test('a refusal without an inner field message uses generic copy', async () => {
  const { fetch, onCreate } = setup({ errors: [{ message: 'The following field is invalid: flagPoint' }] }, 400)
  create()
  expect((await screen.findByRole('alert')).textContent).toBe("Couldn't create the test. Try again.")
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(onCreate).not.toHaveBeenCalled()
})

test.each([false, true])('creation dialog keeps its host accent and theme (dark: %s)', async dark => {
  const source = document.createElement('div')
  if (dark) source.dataset.theme = 'dark'
  source.style.setProperty('--xp-accent', '#1f3a68')
  source.style.setProperty('--xp-accent-fg', '#ffffff')
  document.body.append(source)
  let drawer!: ReturnType<typeof openCreateExperimentDrawer>
  await act(async () => { drawer = openCreateExperimentDrawer(source, { admin: '/manage', api: '/api' }, { initialName: 'Page', onCreate: vi.fn() }) })
  const root = screen.getByRole('dialog').closest<HTMLElement>('.xp-slot-root')!
  expect(root.style.getPropertyValue('--xp-accent')).toBe('#1f3a68')
  expect(root.style.getPropertyValue('--xp-accent-fg')).toBe('#ffffff')
  expect(root.matches("[data-theme='dark'] .xp-slot-root")).toBe(dark)
  await act(async () => drawer.closeIfIdle())
  source.remove()
})

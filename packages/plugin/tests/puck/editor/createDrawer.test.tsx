// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CreateExperimentDrawer } from '../../../src/puck/editor/CreateExperimentDrawer.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const collision = { errors: [{ message: 'That slug is already in use.', data: { errors: [{ path: 'slug', message: 'Value must be unique' }] } }] }
function setup(body: unknown = { doc: { id: 42, slug: 'new-test' } }, status = 200) {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response(body, status))
  vi.stubGlobal('fetch', fetch)
  const onCreate = vi.fn(), onClose = vi.fn()
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
  create()
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ id: 42, slug: 'new-test' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0]).toEqual(['/api/xp-experiments?where[slug][like]=new-test&depth=0&limit=200&select[slug]=true', { credentials: 'include' }])
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
  expect(fetch.mock.calls[2]![0]).toBe(fetch.mock.calls[0]![0])
  expect(JSON.parse(fetch.mock.calls[3]![1].body)).toEqual({ ...expectedBody, slug: 'new-test-3' })
})
test('a second collision stays inline and never retries a third time', async () => {
  const { fetch, onCreate, onClose } = setup(collision, 400)
  fetch.mockResolvedValueOnce(response({ docs: [{ slug: 'new-test' }] })).mockResolvedValueOnce(response(collision, 400))
  create()
  expect((await screen.findByRole('alert')).textContent).toBe('That slug is already in use.')
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(onCreate).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})
test('other Payload refusals are inline without retrying', async () => {
  const { fetch, onCreate } = setup({ errors: [{ message: 'Name is required.' }] }, 400)
  create()
  expect((await screen.findByRole('alert')).textContent).toBe('Name is required.')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(onCreate).not.toHaveBeenCalled()
})
test.each(['network', 'malformed', 'lookup'])('%s failure stays in the drawer', async mode => {
  const { fetch, onCreate } = setup({ doc: {} })
  if (mode === 'network') fetch.mockReset().mockRejectedValue(new Error('offline'))
  if (mode === 'lookup') fetch.mockReset().mockResolvedValue(response({}, 403))
  create()
  expect((await screen.findByRole('alert')).textContent).toBe("Couldn't create the experiment. Try again.")
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

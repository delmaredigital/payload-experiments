// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CreateExperimentDrawer } from '../../../src/puck/editor/CreateExperimentDrawer.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup(body: unknown = { doc: { id: 42, slug: 'new-test', name: 'New test' } }, ok = true) {
  const fetch = vi.fn().mockResolvedValue({ ok, json: async () => body })
  vi.stubGlobal('fetch', fetch)
  const onCreate = vi.fn(), onClose = vi.fn()
  render(<CreateExperimentDrawer onCreate={onCreate} onClose={onClose} />)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New test' } })
  return { fetch, onCreate, onClose }
}

test('slug follows the name, posts only create fields, and binds id and slug', async () => {
  const { fetch, onCreate, onClose } = setup()
  expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('new-test')
  fireEvent.click(screen.getByRole('button', { name: 'Create experiment' }))
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ id: 42, slug: 'new-test' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledWith('/api/xp-experiments', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New test', slug: 'new-test', kind: 'block', unitType: 'visitor' }),
  })
})

test('a manually edited slug survives later name edits', async () => {
  const { fetch } = setup()
  fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'custom-slug' } })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Different name' } })
  expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('custom-slug')
  fireEvent.click(screen.getByRole('button', { name: 'Create experiment' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ name: 'Different name', slug: 'custom-slug', kind: 'block', unitType: 'visitor' })
})

test('Payload errors are inline and never bind a failed create', async () => {
  const { onCreate, onClose } = setup({ errors: [{ message: 'That slug is already in use.' }] }, false)
  fireEvent.click(screen.getByRole('button', { name: 'Create experiment' }))
  expect((await screen.findByRole('alert')).textContent).toBe('That slug is already in use.')
  expect(onCreate).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

test.each(['network', 'malformed'])('%s failure stays in the drawer', async mode => {
  const { fetch, onCreate } = setup({ doc: {} })
  if (mode === 'network') fetch.mockRejectedValue(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Create experiment' }))
  expect((await screen.findByRole('alert')).textContent).toBe("Couldn't create the experiment. Try again.")
  expect(onCreate).not.toHaveBeenCalled()
})

test('cancel closes without posting', () => {
  const { fetch, onClose } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
})

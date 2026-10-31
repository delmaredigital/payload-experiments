// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ExperimentPicker } from '../../src/puck/ExperimentPicker.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const docs = [
  { id: 42, slug: 'draft-example', name: 'First example', status: 'draft' },
  { id: 'uuid-running', slug: 'running-example', name: 'Second example', status: 'running' },
  { id: 43, slug: 'stopped-example', name: 'Third example', status: 'stopped' },
  { id: 44, slug: 'decided-example', name: 'Fourth example', status: 'decided' },
  { id: 45, slug: 'archived-example', name: 'Fifth example', status: 'archived' },
]

function mockFetch(body: unknown = { docs }, status = 200) {
  const fetch = vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => body })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

test('loads block experiments with editor credentials and shows names, status labels, and No experiment', async () => {
  const fetch = mockFetch()
  render(<ExperimentPicker value={null} onChange={vi.fn()} />)
  expect(screen.getByRole('status').textContent).toBe('Loading experiments…')
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
  await screen.findByRole('option', { name: 'First example · Draft' })
  expect(fetch).toHaveBeenCalledWith('/api/xp-experiments?where[kind][equals]=block&depth=0&limit=100&sort=-updatedAt', {
    credentials: 'include', signal: expect.any(AbortSignal),
  })
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
    'No experiment', 'First example · Draft', 'Second example · Running', 'Third example · Stopped', 'Fourth example · Decided', 'Fifth example · Archived',
  ])
  expect(screen.queryByRole('status')).toBeNull()
})

test('selection stores only id and slug, preserves id types, and clears to null', async () => {
  mockFetch()
  const onChange = vi.fn()
  const view = render(<ExperimentPicker value={null} onChange={onChange} />)
  await screen.findByRole('option', { name: 'First example · Draft' })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '42' } })
  expect(onChange).toHaveBeenLastCalledWith({ id: 42, slug: 'draft-example' })
  view.rerender(<ExperimentPicker value={{ id: 42, slug: 'draft-example' }} onChange={onChange} />)
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('42')
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'uuid-running' } })
  expect(onChange).toHaveBeenLastCalledWith({ id: 'uuid-running', slug: 'running-example' })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
  expect(onChange).toHaveBeenLastCalledWith(null)
})

test.each([
  [403, "You can't see experiments. Ask an admin."],
  [500, "Couldn't load experiments."],
])('HTTP %s shows the error copy', async (status, message) => {
  mockFetch({}, status)
  render(<ExperimentPicker value={null} onChange={vi.fn()} />)
  expect((await screen.findByRole('alert')).textContent).toBe(message)
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
})

test('network failure never throws and displays the load error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  expect(() => render(<ExperimentPicker value={null} onChange={vi.fn()} />)).not.toThrow()
  expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load experiments.")
})

test('malformed responses show the load error; invalid documents never crash rendering', async () => {
  const fetch = mockFetch({ docs: null })
  const view = render(<ExperimentPicker value={null} onChange={vi.fn()} />)
  await screen.findByRole('alert')
  view.unmount()
  fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ docs: [null, {}, ...docs] }) })
  render(<ExperimentPicker value={null} onChange={vi.fn()} />)
  await screen.findByRole('option', { name: 'First example · Draft' })
  expect(screen.getAllByRole('option')).toHaveLength(6)
})

test('keeps a saved reference visible when absent from the latest list', async () => {
  mockFetch({ docs: [] })
  render(<ExperimentPicker value={{ id: 'saved-id', slug: 'saved-example' }} onChange={vi.fn()} />)
  await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false))
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('saved-id')
  expect(screen.getByRole('option', { name: 'saved-example' })).toBeTruthy()
})

test('unmount aborts the pending request', () => {
  const fetch = vi.fn().mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('fetch', fetch)
  const view = render(<ExperimentPicker value={null} onChange={vi.fn()} />)
  const signal = fetch.mock.calls[0]![1].signal as AbortSignal
  view.unmount()
  expect(signal.aborted).toBe(true)
})

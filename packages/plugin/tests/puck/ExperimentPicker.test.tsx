// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { createExperimentSlotField } from '../../src/puck/experimentSlotField.js'
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

test('loads block experiments with editor credentials and shows names, status labels, and No test', async () => {
  const fetch = mockFetch()
  render(<ExperimentPicker value={null} onChange={vi.fn()} />)
  expect(screen.getByRole('status').textContent).toBe('Loading tests…')
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
  await screen.findByRole('option', { name: 'First example · Draft' })
  expect(fetch).toHaveBeenCalledWith('/api/xp-experiments?where%5Bkind%5D%5Bequals%5D=block&depth=0&sort=id&limit=100&page=1', {
    credentials: 'include', signal: expect.any(AbortSignal),
  })
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
    'No test', 'First example · Draft', 'Second example · Running', 'Third example · Stopped', 'Fourth example · Decided', 'Fifth example · Archived',
  ])
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('searchbox')).toBeNull()
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
  [403, "You can't see tests. Ask an admin."],
  [500, "Couldn't load tests."],
])('HTTP %s shows the error copy', async (status, message) => {
  mockFetch({}, status)
  render(<ExperimentPicker value={null} onChange={vi.fn()} />)
  expect((await screen.findByRole('alert')).textContent).toBe(message)
  // Enabled on error so an editor can still choose "No test" to unbind.
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false)
})

test('network failure never throws and displays the load error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  expect(() => render(<ExperimentPicker value={null} onChange={vi.fn()} />)).not.toThrow()
  expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load tests.")
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

test.each(['render', 'editor'] as const)('%s factory supplies custom sidebar routes', async kind => {
  const { createExperimentSlot } = await import('../../src/puck/ExperimentSlot.js')
  // Importing the editor requires Puck's browser measurement API in jsdom.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const { createExperimentSlotEditor } = await import('../../src/puck/editor/ExperimentSlotEditor.js')
  const factory = kind === 'render' ? createExperimentSlot : createExperimentSlotEditor
  const config = factory({ routes: { api: '/content-api/', admin: '/manage/' } })
  const field = config.fields!.experiment
  if (field.type !== 'custom') throw new Error('Expected custom picker field')
  const fetch = mockFetch()
  render(field.render({ field, value: null, onChange: vi.fn(), name: 'experiment', id: 'test' }))
  await screen.findByRole('option', { name: 'First example · Draft' })
  expect(fetch).toHaveBeenCalledWith('/content-api/xp-experiments?where%5Bkind%5D%5Bequals%5D=block&depth=0&sort=id&limit=100&page=1', expect.objectContaining({ credentials: 'include' }))
  expect(screen.getByRole('combobox').closest('.xp-puck-field')).toBeTruthy()
  expect(screen.getByRole('combobox', { name: 'Test' }).classList.contains('xp-ui-select')).toBe(true)
})

test('all 150 tests load; search above eight filters name and slug but keeps the bound test', async () => {
  const all = Array.from({ length: 150 }, (_, id) => ({ id, slug: `block-${id}`, name: `Test ${id}`, status: 'draft' }))
  const fetch = vi.fn(async (url: string) => {
    const page = Number(new URL(url, 'https://example.test').searchParams.get('page'))
    return new Response(JSON.stringify({ docs: all.slice((page - 1) * 100, page * 100), hasNextPage: page < 2 }))
  })
  vi.stubGlobal('fetch', fetch)
  render(<ExperimentPicker value={{ id: 149, slug: 'block-149' }} onChange={vi.fn()} />)
  await screen.findByRole('option', { name: 'Test 149 · Draft' })
  expect(screen.getAllByRole('option')).toHaveLength(151)
  expect(fetch).toHaveBeenCalledTimes(2)
  const search = screen.getByRole('searchbox', { name: 'Search tests' })
  const select = screen.getByRole('combobox')
  const label = select.previousElementSibling!
  expect(label.tagName).toBe('LABEL')
  expect(label.textContent).toBe('Test')
  expect(label.getAttribute('for')).toBe(select.id)
  expect(search.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(search.hasAttribute('placeholder')).toBe(false)
  fireEvent.change(search, { target: { value: '  TEST 12  ' } })
  expect(screen.getAllByRole('option')).toHaveLength(13) // none, 12/120–129, bound
  expect(screen.queryByRole('option', { name: 'Test 1 · Draft' })).toBeNull()
  fireEvent.change(search, { target: { value: ' BLOCK-2 ' } })
  expect(screen.getByRole('option', { name: 'Test 2 · Draft' })).toBeTruthy()
  expect(screen.getAllByRole('option')).toHaveLength(13)
  fireEvent.change(search, { target: { value: 'absent' } })
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['No test', 'Test 149 · Draft'])
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('149')
  fireEvent.change(search, { target: { value: '' } })
  expect(screen.getAllByRole('option')).toHaveLength(151)
})
test('exactly eight tests do not show search', async () => {
  mockFetch({ docs: Array.from({ length: 8 }, (_, id) => ({ ...docs[0], id })) })
  render(<ExperimentPicker value={null} onChange={vi.fn()} />)
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(9))
  expect(screen.queryByRole('searchbox')).toBeNull()
})

test('stable paging keeps newest activity order and renders a repeated document once', async () => {
  const older = { ...docs[0], updatedAt: '2026-11-01T00:00:00Z' }
  const newer = { ...docs[1], updatedAt: '2026-11-03T00:00:00Z' }
  const fetch = vi.fn(async (url: string) => {
    const params = new URL(url, 'https://example.test').searchParams
    expect(params.get('sort')).toBe('id')
    const first = params.get('page') === '1'
    return new Response(JSON.stringify({ docs: first ? [older] : [newer, { ...older, name: 'Repeated' }], hasNextPage: first }))
  })
  vi.stubGlobal('fetch', fetch)
  render(<ExperimentPicker value={null} onChange={vi.fn()} />)
  await screen.findByRole('option', { name: 'Second example · Running' })
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['No test', 'Second example · Running', 'First example · Draft'])
})

test('standalone sidebar field wraps the picker root in its stylesheet scope', async () => {
  mockFetch()
  const field = createExperimentSlotField()
  const view = render(field.render({ field, value: null, onChange: vi.fn(), name: 'experiment', id: 'field' }))
  await screen.findByRole('option', { name: 'First example · Draft' })
  const root = view.container.querySelector('.xp-puck-field > .xp-ui-field')
  expect(root).toBeTruthy()
  expect(screen.getByRole('combobox').closest('.xp-ui-field')).toBe(root)
})

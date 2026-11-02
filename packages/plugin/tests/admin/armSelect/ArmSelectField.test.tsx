// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ArmSelectField } from '../../../src/admin/armSelect/ArmSelectField.js'
import { resetPayloadUiMock, setConfig, setField } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals() })
const field = { name: 'tag', type: 'group' as const, admin: { custom: { flagPoint: 'donation ask' }, hideGutter: false }, fields: [
  { name: 'experiment', type: 'text' as const },
  { name: 'arm', type: 'text' as const, required: true },
] }
const arms = [ { key: 'control', kind: 'control', label: 'Original' },
  { key: 'variantA', kind: 'variant', label: 'New heading' }, { key: 'holdout', kind: 'holdout', label: 'Holdout' } ]
const live = { id: 2, name: 'Current test', status: 'running', arms }
function fields(experiment: unknown = null, arm: unknown = null) {
  const setExperiment = vi.fn((value: unknown) => setField({ value, setValue: setExperiment }, 'rows.0.tag.experiment'))
  const setArm = vi.fn((value: unknown) => setField({ value, setValue: setArm }, 'rows.0.tag.arm'))
  setField({ value: experiment, setValue: setExperiment }, 'rows.0.tag.experiment')
  setField({ value: arm, setValue: setArm }, 'rows.0.tag.arm')
  return { setExperiment, setArm }
}
function stub(liveDocs: unknown[] = [live], candidates: unknown[] = []) {
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input, 'https://example.com')
    const docs = url.searchParams.get('where[status][in]') === 'running,decided' ? liveDocs : candidates
    return { ok: true, json: async () => ({ docs }) }
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
test('uses the configured route, editor credentials and both flag-point queries; writes both nested fields', async () => {
  setConfig({ config: { routes: { api: '/custom-api', admin: '/admin' } } })
  const { setExperiment, setArm } = fields()
  const fetcher = stub()
  render(<ArmSelectField path="rows.0.tag" field={field} />)
  const select = await screen.findByLabelText('Group')
  expect(screen.queryByLabelText('Experiment')).toBeNull()
  expect(screen.queryByRole('option', { name: 'Holdout' })).toBeNull()
  expect(screen.getByText('Changing this content mid-test mixes two versions in one result')).toBeTruthy()
  expect(fetcher.mock.calls).toHaveLength(2)
  const statuses = fetcher.mock.calls.map(([input]) => {
    const url = new URL(input, 'https://example.com')
    expect(url.pathname).toBe('/custom-api/xp-experiments')
    expect(url.searchParams.get('depth')).toBe('0')
    expect(url.searchParams.get('where[flagPoint][equals]')).toBe('donation ask')
    return url.searchParams.get('where[status][in]')
  })
  expect(statuses).toEqual(['running,decided', 'draft,stopped'])
  expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'include' }))
  fireEvent.change(select, { target: { value: 'variantA' } })
  expect(setExperiment).toHaveBeenCalledWith('2')
  expect(setArm).toHaveBeenCalledWith('variantA')
})
test('candidate picker sets the experiment and clears the previous group', async () => {
  const { setExperiment, setArm } = fields()
  stub([], [{ ...live, status: 'stopped' }])
  render(<ArmSelectField path="rows.0.tag" field={field} />)
  fireEvent.change(await screen.findByLabelText('Experiment'), { target: { value: '2' } })
  expect(setExperiment).toHaveBeenCalledWith('2')
  expect(setArm).toHaveBeenCalledWith(null)
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'control' } })
  expect(setArm).toHaveBeenLastCalledWith('control')
})
test('stale selection does not show a matching key from another experiment; Clear removes both fields', async () => {
  const { setExperiment, setArm } = fields(1, 'variantA')
  stub([live], [{ ...live, id: 1, name: 'Earlier test', status: 'draft' }])
  render(<ArmSelectField path="rows.0.tag" field={field} />)
  await screen.findByText("This was set for an earlier experiment (Earlier test) and won't be used now.")
  expect((screen.getByLabelText('Group') as HTMLSelectElement).value).toBe('')
  expect(setExperiment).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(setExperiment).toHaveBeenCalledWith(null)
  expect(setArm).toHaveBeenCalledWith(null)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull())
})
test('403 displays the agreed access state', async () => {
  fields()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })))
  render(<ArmSelectField path="rows.0.tag" field={field} />)
  expect(await screen.findByText("You can't see experiments. Ask an admin.")).toBeTruthy()
  expect(screen.queryByLabelText('Group')).toBeNull()
})
test('read-only fields cannot change either stored value', async () => {
  const { setExperiment, setArm } = fields(2, 'control')
  stub()
  render(<ArmSelectField path="rows.0.tag" field={field} readOnly />)
  expect((await screen.findByLabelText('Group') as HTMLSelectElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'variantA' } })
  expect(setExperiment).not.toHaveBeenCalled()
  expect(setArm).not.toHaveBeenCalled()
})
test('the required arm validation message is visible after validation', async () => {
  const { setArm } = fields()
  setField({ value: null, setValue: setArm, showError: false, errorMessage: 'Please choose a group.' }, 'rows.0.tag.arm')
  stub()
  render(<ArmSelectField path="rows.0.tag" field={field} />)
  await screen.findByLabelText('Group')
  expect(screen.queryByRole('alert')).toBeNull()
  act(() => setField({ value: null, setValue: setArm, showError: true, errorMessage: 'Please choose a group.' }, 'rows.0.tag.arm'))
  expect(screen.getByRole('alert').textContent).toBe('Please choose a group.')
})
test('a deleted earlier experiment uses the nameless stale message', async () => {
  fields('deleted', 'variantA')
  vi.stubGlobal('fetch', vi.fn(async (input: string) => input.includes('/xp-experiments/deleted?')
    ? { ok: false, status: 404 }
    : { ok: true, json: async () => ({ docs: input.includes('running%2Cdecided') ? [live] : [] }) }))
  render(<ArmSelectField path="rows.0.tag" field={field} />)
  expect(await screen.findByText("This was set for an earlier experiment and won't be used now.")).toBeTruthy()
  await act(async () => {})
  expect(screen.getByText("This was set for an earlier experiment and won't be used now.")).toBeTruthy()
})
test('missing flag-point configuration renders guidance and skips every fetch', async () => {
  fields('earlier', 'variantA')
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(<ArmSelectField path="rows.0.tag" field={{ ...field, admin: { hideGutter: false } }} />)
  await act(async () => {})
  expect(screen.getByText('No setting is configured for this field.')).toBeTruthy()
  expect(screen.queryByLabelText('Group')).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})
test('a late earlier-experiment name cannot replace the name for a newer stored id', async () => {
  fields('1', 'variantA')
  let resolveOld!: (value: unknown) => void
  let resolveNew!: (value: unknown) => void
  const fetcher = vi.fn((input: string) => {
    const url = new URL(input, 'https://example.com')
    if (url.pathname.endsWith('/1')) return new Promise(resolve => { resolveOld = resolve })
    if (url.pathname.endsWith('/3')) return new Promise(resolve => { resolveNew = resolve })
    return Promise.resolve({ ok: true, json: async () => ({ docs: url.searchParams.get('where[status][in]') === 'running,decided' ? [live] : [] }) })
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ArmSelectField path="rows.0.tag" field={field} />)
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
  act(() => { fields('3', 'variantA') })
  await waitFor(() => expect(resolveNew).toBeTypeOf('function'))
  await act(async () => resolveNew({ ok: true, json: async () => ({ name: 'Newer stored test' }) }))
  const message = "This was set for an earlier experiment (Newer stored test) and won't be used now."
  expect(screen.getByText(message)).toBeTruthy()
  await act(async () => resolveOld({ ok: true, json: async () => ({ name: 'Older stored test' }) }))
  expect(screen.getByText(message)).toBeTruthy()
  expect(screen.queryByText(/Older stored test/)).toBeNull()
})

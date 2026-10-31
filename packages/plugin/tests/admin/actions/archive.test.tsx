// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ConfirmDialog } from '../../../src/admin/actions/ConfirmDialog.js'
import { ExperimentActions } from '../../../src/admin/actions/ExperimentActions.js'
import { availableActions } from '../../../src/admin/actions/actions.model.js'
import { reloadPage } from '../../../src/admin/reload.js'
import { expectedConfirm } from '../../../src/transitions/confirmPhrases.js'
import { resetPayloadUiMock, setAuth, setDocumentInfo, setFormFields, setFormModified } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
vi.mock('../../../src/admin/reload.js', () => ({ reloadPage: vi.fn() }))
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
test.each(['discard', 'hard-coded'] as const)('%s uses shared typed phrase and exact archive body', async mode => {
  const action = availableActions({ status: 'decided', kind: 'code', canManage: true,
    arms: [{ key: 'control' }, { key: 'variantA' }], decision: { winnerArm: 'variantA' } }).find(item => item.id === mode)!
  let resolve!: (value: Response) => void
  const pending = new Promise<Response>(done => { resolve = done })
  const fetcher = vi.fn().mockReturnValue(pending)
  vi.stubGlobal('fetch', fetcher)
  render(<ConfirmDialog id="xp1" action={action} winnerLabel="Variant A" onClose={vi.fn()} />)
  const phrase = expectedConfirm(mode, 'Variant A')
  expect(screen.getByText(phrase, { selector: 'strong' })).toBeTruthy()
  const submit = screen.getByRole('button', { name: action.label }) as HTMLButtonElement
  expect(submit.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: 'wrong' } })
  expect(submit.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: ` ${phrase} ` } })
  expect(submit.disabled).toBe(false)
  act(() => { submit.click(); submit.click() })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(submit.disabled).toBe(true)
  expect((screen.getByLabelText('Confirmation') as HTMLInputElement).readOnly).toBe(true)
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  resolve(response({ doc: {}, revision: 2 }))
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  expect(submit.disabled).toBe(true)
  fireEvent.click(submit)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/xp/experiments/xp1/archive')
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ mode, confirmation: phrase })
})
test('archive refusal remains open and a retryable refusal offers retry', async () => {
  const action = availableActions({ status: 'stopped', kind: 'block', arms: [], canManage: true }).find(item => item.id === 'archive')!
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ errors: [{ code: 'commit-unverified' }] }, 500)))
  render(<ConfirmDialog id={1} action={action} winnerLabel="Original" onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(reloadPage).not.toHaveBeenCalled()
})
test('panel reads live flattened fields, permissions and id; routes finish archiving', async () => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  setFormFields({ status: { value: 'decided' }, kind: { value: 'page' },
    'arms.0.key': { value: 'control' }, 'arms.1.key': { value: 'variantA' }, 'arms.2.key': { value: 'holdout' },
    'decision.winnerArm': { value: 'variantA' }, 'decision.holdoutReleasedAt': { value: '2026-10-30' },
    'decision.contentReport': { value: { docs: [{ collection: 'pages', id: 1, ok: true }] } } })
  const fetcher = vi.fn().mockResolvedValue(response({ doc: {}, revision: 3 }))
  vi.stubGlobal('fetch', fetcher)
  render(<ExperimentActions field={{ name: 'actions', type: 'ui', admin: {} }} path="actions" />)
  expect(screen.queryByRole('button', { name: 'Release holdout' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Finish archiving' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(dialog.querySelector('button')!)
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ mode: 'after-content' })
})
test('create form and read-only users have no actions', () => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  setDocumentInfo({ id: undefined })
  const view = render(<ExperimentActions field={{ name: 'actions', type: 'ui', admin: {} }} path="actions" />)
  expect(screen.queryByRole('button')).toBeNull()
  view.unmount()
  setDocumentInfo({ id: '1' })
  setAuth({ permissions: { collections: {} } })
  render(<ExperimentActions field={{ name: 'actions', type: 'ui', admin: {} }} path="actions" />)
  expect(screen.queryByRole('button')).toBeNull()
})

test('hard-coded panel label and typed phrase use the trimmed stored winner label', async () => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  setFormFields({ status: { value: 'decided' }, kind: { value: 'code' },
    'arms.0.key': { value: 'control' }, 'arms.1.key': { value: 'variantA' },
    'arms.1.label': { value: ' Short headline ' }, 'decision.winnerArm': { value: 'variantA' } })
  const fetcher = vi.fn().mockResolvedValue(response({ doc: {}, revision: 2 }))
  vi.stubGlobal('fetch', fetcher)
  render(<ExperimentActions field={{ name: 'actions', type: 'ui', admin: {} }} path="actions" />)
  fireEvent.click(screen.getByRole('button', { name: 'The developer has hard-coded Short headline' }))
  const phrase = expectedConfirm('hard-coded', 'Short headline')
  expect(screen.getByText(phrase, { selector: 'strong' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: ` ${phrase} ` } })
  const dialog = screen.getByRole('dialog')
  fireEvent.click(dialog.querySelector('button')!)
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ mode: 'hard-coded', confirmation: phrase })
})

test('unsaved changes disable every action and explain why', () => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  setFormFields({ status: { value: 'stopped' }, kind: { value: 'block' },
    'arms.0.key': { value: 'control' }, 'arms.1.key': { value: 'variantA' }, 'arms.1.label': { value: 'Renamed, not saved' } })
  setFormModified(true)
  render(<ExperimentActions field={{ name: 'actions', type: 'ui', admin: {} }} path="actions" />)
  const buttons = screen.getAllByRole('button')
  expect(buttons.length).toBeGreaterThan(0)
  for (const button of buttons) expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Save your changes first; these actions use the saved experiment.')).toBeTruthy()
  fireEvent.click(buttons[0]!)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('draft and archived experiments explain what deleting does', () => {
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  setFormFields({ status: { value: 'archived' }, kind: { value: 'flag' }, 'arms.0.key': { value: 'control' }, 'arms.1.key': { value: 'variantA' } })
  const view = render(<ExperimentActions field={{ name: 'actions', type: 'ui', admin: {} }} path="actions" />)
  expect(screen.getByText("Deleting removes this experiment's records and results. A winner that was already made permanent stays in place.")).toBeTruthy()
  view.unmount()
  setFormFields({ status: { value: 'draft' }, kind: { value: 'block' }, 'arms.0.key': { value: 'control' }, 'arms.1.key': { value: 'variantA' } })
  render(<ExperimentActions field={{ name: 'actions', type: 'ui', admin: {} }} path="actions" />)
  expect(screen.getByText('Deleting removes this experiment and its settings.')).toBeTruthy()
})

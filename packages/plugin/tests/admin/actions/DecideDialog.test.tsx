// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { DecideDialog } from '../../../src/testSurface/actions/DecideDialog.js'
import { reloadPage } from '../../../src/testSurface/reload.js'
import { expectedConfirm } from '../../../src/transitions/confirmPhrases.js'
import T1 from '../../_fixtures/snapshots/T1.json'
import T2 from '../../_fixtures/snapshots/T2.json'
import T3 from '../../_fixtures/snapshots/T3.json'
import T7 from '../../_fixtures/snapshots/T7.json'
import T4 from '../../_fixtures/snapshots/T4.json'

vi.mock('../../../src/testSurface/reload.js', () => ({ reloadPage: vi.fn() }))
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const arms = [{ key: 'control' }, { key: 'variantA' }, { key: 'holdout' }]
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const submitButton = () => screen.getByRole('button', { name: 'Decide' }) as HTMLButtonElement
function chooseAndConfirm() {
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'variantA' } })
  fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'We reviewed this.' } })
  fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: expectedConfirm('decide', 'Variant A') } })
}
test('guarded submit requires note and exact typed label; sends wire body and reloads once', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ phases: [], snapshot: null }))
    .mockResolvedValueOnce(response({ doc: {}, revision: 2 }))
  vi.stubGlobal('fetch', fetcher)
  render(<DecideDialog apiRoute="/api" id="xp1" arms={arms} onClose={vi.fn()} />)
  expect(submitButton().disabled).toBe(true)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(screen.getByRole('button', { name: 'Cancel' })).toBe(document.activeElement)
  expect(screen.queryByRole('option', { name: 'Holdout' })).toBeNull()
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'variantA' } })
  expect(submitButton().disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'We reviewed this.' } })
  fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: 'variant a' } })
  expect(submitButton().disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: ` ${expectedConfirm('decide', 'Variant A')} ` } })
  expect(submitButton().disabled).toBe(false)
  fireEvent.click(submitButton())
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  expect(fetcher.mock.calls[1]?.[0]).toBe('/api/xp/experiments/xp1/decide')
  expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ winnerArm: 'variantA', note: 'We reviewed this.', confirmation: 'Variant A' })
})
test('recommended row 7 prefill is unguarded; refusal message stays open without reload', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ phases: [], snapshot: T7 }))
    .mockResolvedValueOnce(response({ errors: [{ code: 'future-refusal', message: 'Please review the latest settings.' }] }, 409)))
  render(<DecideDialog apiRoute="/api" id={1} arms={arms} onClose={vi.fn()} />)
  await waitFor(() => expect(submitButton().disabled).toBe(false))
  expect((screen.getByLabelText('Group') as HTMLSelectElement).value).toBe(T7.verdict.recommendedArm)
  expect(screen.queryByLabelText('Confirmation')).toBeNull()
  fireEvent.click(submitButton())
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Please review the latest settings.')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(reloadPage).not.toHaveBeenCalled()
})
test('confirmation-required refetches newest results and re-evaluates the guard without resetting choice', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ phases: [], snapshot: T7 }))
    .mockResolvedValueOnce(response({ errors: [{ code: 'confirmation-required', message: 'Confirm this choice.' }] }, 422))
    .mockResolvedValueOnce(response({ phases: [], snapshot: T4 }))
  vi.stubGlobal('fetch', fetcher)
  render(<DecideDialog apiRoute="/api" id={1} arms={arms} onClose={vi.fn()} />)
  await waitFor(() => expect(submitButton().disabled).toBe(false))
  fireEvent.click(submitButton())
  await screen.findByLabelText('Confirmation')
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(fetcher.mock.calls.filter(call => call[0].endsWith('/results'))).toHaveLength(2)
  expect((screen.getByLabelText('Group') as HTMLSelectElement).value).toBe('variantA')
  expect(submitButton().disabled).toBe(true)
  expect(screen.getByRole('alert').textContent).toBe('Confirm this choice.')
  chooseAndConfirm()
  expect(submitButton().disabled).toBe(false)
  expect(reloadPage).not.toHaveBeenCalled()
})
test('retryable POST refusal offers Retry and reloads only after successful retry', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ phases: [], snapshot: T7 }))
    .mockResolvedValueOnce(response({ errors: [{ code: 'commit-unverified', message: 'Unverified' }] }, 500))
    .mockResolvedValueOnce(response({ doc: {}, revision: 3 }))
  vi.stubGlobal('fetch', fetcher)
  render(<DecideDialog apiRoute="/api" id={1} arms={arms} onClose={vi.fn()} />)
  await waitFor(() => expect(submitButton().disabled).toBe(false))
  fireEvent.click(submitButton())
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
})
test('failed results load can retry; Escape closes and restores trigger focus', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response({ phases: [], snapshot: null }))
  vi.stubGlobal('fetch', fetcher)
  const onClose = vi.fn()
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const view = render(<DecideDialog apiRoute="/api" id={1} arms={arms} onClose={onClose} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(screen.queryByRole('alert')).toBeNull()
  chooseAndConfirm()
  expect(submitButton().disabled).toBe(false)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})

test('rapid Decide clicks submit once; pending controls and successful submit stay locked', async () => {
  let resolve!: (value: Response) => void
  const pending = new Promise<Response>(done => { resolve = done })
  const fetcher = vi.fn().mockResolvedValueOnce(response({ phases: [], snapshot: null })).mockReturnValue(pending)
  vi.stubGlobal('fetch', fetcher)
  render(<DecideDialog apiRoute="/api" id={1} arms={arms} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  chooseAndConfirm()
  const submit = submitButton()
  act(() => { submit.click(); submit.click() })
  expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
  expect(submit.disabled).toBe(true)
  expect((screen.getByLabelText('Group') as HTMLSelectElement).disabled).toBe(true)
  expect((screen.getByLabelText('Decision note') as HTMLTextAreaElement).readOnly).toBe(true)
  expect((screen.getByLabelText('Confirmation') as HTMLInputElement).readOnly).toBe(true)
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  resolve(response({ doc: {}, revision: 2 }))
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  expect(submit.disabled).toBe(true)
  fireEvent.click(submit)
  expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
})

test.each([
  { name: 'Original', chosen: 'control', holdout: true, copy: 'Everyone will see the Original.' },
  { name: 'variant with holdout', chosen: 'variantA', holdout: true, copy: 'Everyone except the holdout will see Short headline. The holdout keeps seeing the Original so we can measure the shipped change.' },
  { name: 'variant without holdout', chosen: 'variantA', holdout: false, copy: 'Everyone will see Short headline.' },
])('$name copy renders with the stored group label', async ({ chosen, holdout, copy }) => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ phases: [], snapshot: null })).mockResolvedValueOnce(response({ doc: {}, revision: 2 }))
  vi.stubGlobal('fetch', fetcher)
  render(<DecideDialog apiRoute="/api" id={1} arms={[
    { key: 'control', label: ' Original ' }, { key: 'variantA', label: ' Short headline ' },
    ...(holdout ? [{ key: 'holdout' }] : []),
  ]} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(screen.getByRole('option', { name: 'Short headline' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: chosen } })
  expect(screen.getByText(copy)).toBeTruthy()
  const phrase = expectedConfirm('decide', chosen === 'control' ? 'Original' : 'Short headline')
  expect(screen.getByText(phrase, { selector: 'strong' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'Reviewed.' } })
  fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: ` ${phrase} ` } })
  fireEvent.click(submitButton())
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ winnerArm: chosen, note: 'Reviewed.', confirmation: phrase })
})

test.each([
  { name: 'T1 unavailable', snapshot: T1, chosen: 'variantA', reason: T1.verdict.headline },
  { name: 'T2 data problem', snapshot: T2, chosen: 'control', reason: T2.verdict.headline },
  { name: 'T3 guardrail, different choice', snapshot: T3, chosen: 'variantA', reason: T3.verdict.headline },
  { name: 'T4 collecting', snapshot: T4, chosen: 'variantA', reason: T4.verdict.headline },
  { name: 'no results', snapshot: null, chosen: 'variantA', reason: 'There are no results yet.' },
  { name: 'no recommendation', snapshot: { ...T7, verdict: { ...T7.verdict, recommendedArm: null } }, chosen: 'variantA', reason: "The results don't recommend a group yet." },
  { name: 'different choice', snapshot: T7, chosen: 'control', reason: 'You chose a different group than the results recommend.' },
])('$name reason renders only after a group is chosen', async ({ snapshot, chosen, reason }) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ phases: [], snapshot })))
  render(<DecideDialog apiRoute="/api" id={1} arms={arms} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: '' } })
  expect(screen.queryByText(reason)).toBeNull()
  expect(submitButton().disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: chosen } })
  expect(screen.getByText(reason)).toBeTruthy()
  expect(submitButton().disabled).toBe(true)
})

test('Escape consumed by the group dropdown leaves the dialog open', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ phases: [], snapshot: null })))
  const onClose = vi.fn()
  render(<DecideDialog apiRoute="/api" id={1} arms={arms} onClose={onClose} />)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  chooseAndConfirm()
  const group = screen.getByLabelText('Group')
  group.addEventListener('keydown', event => event.preventDefault(), { once: true })
  fireEvent.keyDown(group, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
  expect((screen.getByLabelText('Decision note') as HTMLTextAreaElement).value).toBe('We reviewed this.')
  expect((screen.getByLabelText('Confirmation') as HTMLInputElement).value).toBe('Variant A')
  fireEvent.keyDown(group, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})


test('no recommendation displays an explicit empty selection before choosing Original', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ phases: [], snapshot: null })))
  render(<DecideDialog apiRoute="/api" id={1} arms={arms} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  const group = screen.getByLabelText('Group') as HTMLSelectElement
  expect(group.value).toBe('')
  expect(group.selectedOptions[0]?.textContent).toBe('Choose a group')
  fireEvent.change(group, { target: { value: 'control' } })
  expect(group.value).toBe('control')
  expect(screen.getByText('Everyone will see the Original.')).toBeTruthy()
})

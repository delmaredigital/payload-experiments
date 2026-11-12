// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { ConfirmActionHarness } from './ConfirmActionHarness.js'
import { availableActions } from '../../../src/testSurface/actions/actions.model.js'
import { reloadPage } from '../../../src/testSurface/reload.js'
import { expectedConfirm } from '../../../src/transitions/confirmPhrases.js'
import { resetPayloadUiMock } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
vi.mock('../../../src/testSurface/reload.js', () => ({ reloadPage: vi.fn() }))
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
test.each(['discard', 'hard-coded'] as const)('%s uses shared typed phrase and exact archive body', async mode => {
  const action = availableActions({ status: 'decided', kind: 'code', canManage: true,
    arms: [{ key: 'control' }, { key: 'variantA' }], decision: { winnerArm: 'variantA' } }).find(item => item.id === mode)!
  let resolve!: (value: Response) => void
  const pending = new Promise<Response>(done => { resolve = done })
  const fetcher = vi.fn().mockReturnValue(pending)
  vi.stubGlobal('fetch', fetcher)
  render(<ConfirmActionHarness apiRoute="/api" id="xp1" action={action} winnerLabel="Variant A" onClose={vi.fn()} />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
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
  render(<ConfirmActionHarness apiRoute="/api" id={1} action={action} winnerLabel="Original" onClose={vi.fn()} />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
  await screen.findByRole('alert')
  expect((screen.getByRole('button', { name: 'Archive' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(reloadPage).not.toHaveBeenCalled()
})

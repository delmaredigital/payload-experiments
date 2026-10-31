// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AllocateDialog } from '../../../src/admin/actions/AllocateDialog.js'
import { reloadPage } from '../../../src/admin/reload.js'
import { resetPayloadUiMock } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
vi.mock('../../../src/admin/reload.js', () => ({ reloadPage: vi.fn() }))
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const submit = () => screen.getByRole('button', { name: 'Raise allocation' }) as HTMLButtonElement
test.each(['49', '50', '50.5', '101', ''])('allocation %s is refused client-side', value => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(<AllocateDialog id={1} allocation={50} onClose={vi.fn()} />)
  const input = screen.getByLabelText('Allocation (%)') as HTMLInputElement
  expect(input.min).toBe('51')
  expect(input.max).toBe('100')
  expect(input.step).toBe('1')
  fireEvent.change(input, { target: { value } })
  expect(submit().disabled).toBe(true)
  fireEvent.click(submit())
  expect(fetcher).not.toHaveBeenCalled()
})
test('raise sends only allocation; synchronous guard and controls stay locked through reload', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn().mockReturnValue(new Promise<Response>(done => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  const close = vi.fn()
  render(<AllocateDialog id={1} allocation={50} onClose={close} />)
  fireEvent.change(screen.getByLabelText('Allocation (%)'), { target: { value: '75' } })
  act(() => { submit().click(); submit().click() })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/xp/experiments/1/allocate')
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ allocation: 75 })
  expect((screen.getByLabelText('Allocation (%)') as HTMLInputElement).disabled).toBe(true)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  resolve(response({ doc: {}, revision: 2 }))
  await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1))
  expect(submit().disabled).toBe(true)
})
test('allocation-lower uses editor copy and never reloads', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ errors: [{ code: 'allocation-lower', message: 'allocation-lower' }] }, 422)))
  render(<AllocateDialog id={1} allocation={50} onClose={vi.fn()} />)
  fireEvent.click(submit())
  expect((await screen.findByRole('alert')).textContent).toBe('Choose a higher percentage. Lowering needs a new round.')
  expect(reloadPage).not.toHaveBeenCalled()
  expect(submit().disabled).toBe(false)
})
test('100% allocation cannot rise further', () => {
  render(<AllocateDialog id={1} allocation={100} onClose={vi.fn()} />)
  expect(submit().disabled).toBe(true)
})

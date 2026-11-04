// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { ACTIONS_COPY } from '../../../src/admin/copy/actions.js'
import { MakeContentResult as Report } from '../../../src/admin/actions/MakeContentResult.js'
import { createApi } from '../../../src/admin/api.js'
import type { ComponentProps } from 'react'
import { ConfirmDialog } from '../../../src/admin/actions/ConfirmDialog.js'
import { availableActions } from '../../../src/admin/actions/actions.model.js'
import { reloadPage } from '../../../src/admin/reload.js'
import { resetPayloadUiMock } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
vi.mock('../../../src/admin/reload.js', () => ({ reloadPage: vi.fn() }))
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const api = createApi('/api')
function MakeContentResult(props: ComponentProps<typeof Report>) {
  return <Report id={1} api={api} canManage isDecided {...props} />
}
const partial = { doc: {}, revision: 2, docs: [
  { collection: 'pages', id: 1, ok: true, title: 'Home' },
  { collection: 'pages', id: 2, ok: false, error: 'locked' },
] }
test('partial failure lists document titles or references, results and retry', () => {
  const retry = vi.fn()
  render(<MakeContentResult result={partial} onRetry={retry} />)
  expect(screen.getByText('Home: Updated')).toBeTruthy()
  expect(screen.getByText(`pages/2: Failed — ${ACTIONS_COPY.contentReasons.locked}`)).toBeTruthy()
  expect(screen.getByText("Some pages couldn't be updated. Fix them and retry.")).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledTimes(1)
})
test('make-content retry reposts and keeps results visible until Done reloads', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(partial)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...partial, docs: partial.docs.map(doc => ({ ...doc, ok: true, error: undefined })) })))
  vi.stubGlobal('fetch', fetcher)
  const action = availableActions({ status: 'decided', kind: 'block', arms: [{ key: 'variantA' }],
    decision: { winnerArm: 'variantA' }, canManage: true }).find(item => item.id === 'make-content')!
  render(<ConfirmDialog canManage isDecided id={1} action={action} winnerLabel="Variant A" onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Make it the content' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull())
  expect(fetcher).toHaveBeenCalledTimes(2)
  for (const call of fetcher.mock.calls) {
    expect(call[0]).toBe('/api/xp/experiments/1/make-content')
    expect(call[1].method).toBe('POST')
  }
  expect(reloadPage).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(reloadPage).toHaveBeenCalledTimes(1)
})

test('Retry synchronously prevents rapid duplicate calls and disables itself while pending', async () => {
  let resolve!: () => void
  const pending = new Promise<void>(done => { resolve = done })
  const retry = vi.fn(() => pending)
  render(<MakeContentResult result={partial} onRetry={retry} />)
  const button = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement
  act(() => { button.click(); button.click() })
  expect(retry).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  resolve()
  await waitFor(() => expect(button.disabled).toBe(false))
})

test('make-content and Retry each POST once on rapid clicks with pending controls disabled', async () => {
  let resolveFirst!: (value: Response) => void
  let resolveRetry!: (value: Response) => void
  const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>(done => { resolveFirst = done }))
    .mockReturnValueOnce(new Promise<Response>(done => { resolveRetry = done }))
  vi.stubGlobal('fetch', fetcher)
  const action = availableActions({ status: 'decided', kind: 'block', arms: [{ key: 'variantA' }],
    decision: { winnerArm: 'variantA' }, canManage: true }).find(item => item.id === 'make-content')!
  render(<ConfirmDialog canManage isDecided id={1} action={action} winnerLabel="Variant A" onClose={vi.fn()} />)
  const submit = screen.getByRole('button', { name: 'Make it the content' }) as HTMLButtonElement
  act(() => { submit.click(); submit.click() })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(submit.disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  resolveFirst(new Response(JSON.stringify(partial)))
  const retry = await screen.findByRole('button', { name: 'Retry' }) as HTMLButtonElement
  act(() => { retry.click(); retry.click() })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(retry.disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement).disabled).toBe(true)
  resolveRetry(new Response(JSON.stringify({ ...partial, docs: partial.docs.map(doc => ({ ...doc, ok: true })) })))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull())
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect((screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement).disabled).toBe(false)
})


test.each(['detail', 'error'] as const)('legacy %s never displays stored free text, including on successful entries', field => {
  const { container } = render(<MakeContentResult result={{ doc: {}, revision: 2, docs: [false, true].map((ok, id) => ({
    collection: 'pages', id, ok, [field]: 'secret-value row data',
  })) }} onRetry={vi.fn()} />)
  expect(container.textContent).not.toContain('secret-value')
  expect(screen.getAllByText(new RegExp(ACTIONS_COPY.contentReasons['update-failed'].replaceAll('.', '\\.')))).toHaveLength(2)
})
test.each(Object.keys(ACTIONS_COPY.contentReasons))('report code %s renders authored copy', reason => {
  const { container } = render(<MakeContentResult result={{ doc: {}, revision: 2, docs: [
    { collection: 'pages', id: 1, ok: false, detail: reason, error: 'secret-value legacy duplicate' },
  ] }} onRetry={vi.fn()} />)
  expect(container.textContent).toContain(ACTIONS_COPY.contentReasons[reason as keyof typeof ACTIONS_COPY.contentReasons])
  expect(container.textContent).not.toContain('secret-value')
})
test('an absent page already counted as done explains that no change is needed', () => {
  render(<MakeContentResult result={{ doc: {}, revision: 2, docs: [{ collection: 'pages', id: 1, ok: true, detail: 'not-found' }] }} onRetry={vi.fn()} />)
  expect(screen.getByText(`pages/1: Updated — ${ACTIONS_COPY.missingContent}`)).toBeTruthy()
})

const failedEntry = { collection: 'pages', id: 2, ok: false, error: 'locked' }
const dismissedEntry = { ...failedEntry, dismissedAt: '2026-11-03T12:00:00Z', dismissedBy: 'manager' }
const entryResponse = (entry: typeof failedEntry) => new Response(JSON.stringify({ doc: { decision: { contentReport: { docs: [entry] } } } }))

test('Dismiss and Undo each post once and update from the returned report', async () => {
  let dismiss!: (response: Response) => void
  let restore!: (response: Response) => void
  const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>(resolve => { dismiss = resolve }))
    .mockReturnValueOnce(new Promise<Response>(resolve => { restore = resolve }))
  vi.stubGlobal('fetch', fetcher)
  render(<MakeContentResult result={{ ...partial, docs: [failedEntry] }} onRetry={vi.fn()} onFinish={vi.fn()} />)
  const button = screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement
  act(() => { button.click(); button.click() })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/xp/experiments/1/content-report/dismiss')
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ collection: 'pages', id: 2 })
  dismiss(entryResponse(dismissedEntry))
  const undo = await screen.findByRole('button', { name: 'Undo' }) as HTMLButtonElement
  expect(screen.getByText('pages/2: Dismissed')).toBeTruthy()
  expect(undo.parentElement?.textContent).toBe('pages/2: Dismissed · Undo')
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Finish archiving' })).toBeTruthy()
  act(() => { undo.click(); undo.click() })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(undo.disabled).toBe(true)
  expect(fetcher.mock.calls[1]?.[0]).toBe('/api/xp/experiments/1/content-report/restore')
  expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ collection: 'pages', id: 2 })
  restore(entryResponse(failedEntry))
  await screen.findByRole('button', { name: 'Dismiss' })
  expect(screen.getByText(`pages/2: Failed — ${ACTIONS_COPY.contentReasons.locked}`)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Finish archiving' })).toBeNull()
})

test.each([
  ['all updated', [partial.docs[0]!], true],
  ['mixed updated and dismissed', [partial.docs[0]!, dismissedEntry], true],
  ['still failed', [failedEntry], false],
  ['empty', [], false],
] as const)('Finish appears only when done: %s', (_name, docs, done) => {
  render(<MakeContentResult result={{ ...partial, docs: [...docs] }} onRetry={vi.fn()} onFinish={vi.fn()} />)
  expect(Boolean(screen.queryByRole('button', { name: 'Finish archiving' }))).toBe(done)
})

// CORE-44 deliberately shares invalid-status for these three conditions.
test.each([
  ['not decided', 'invalid-status', 409, ACTIONS_COPY.contentEntryNotDecided],
  ['already dismissed', 'invalid-status', 409, ACTIONS_COPY.contentEntryNotDecided],
  ['already updated', 'invalid-status', 409, ACTIONS_COPY.contentEntryNotDecided],
  ['missing test', 'not-found', 404, ACTIONS_COPY.contentEntryNotFound],
  ['unknown refusal', 'future-code', 422, "Couldn't complete this change. Try again."],
] as const)('dismiss/restore refusal: %s uses persona copy and retains the entry', async (_case, code, status, expected) => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ errors: [{ code, message: 'Experiment not found' }] }), { status })))
  vi.stubGlobal('fetch', fetcher)
  const view = render(<MakeContentResult result={{ ...partial, docs: [failedEntry] }} onRetry={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect((await screen.findByRole('alert')).textContent).toBe(expected)
  expect(view.container.textContent).not.toContain('Experiment not found')
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  view.rerender(<MakeContentResult result={{ ...partial, docs: [dismissedEntry] }} onRetry={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect((await screen.findByRole('alert')).textContent).toBe(expected)
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  expect(view.container.textContent).not.toContain('Experiment not found')
})

test.each([
  [false, true], [true, false], [false, false],
])('readers/non-decided tests have no report actions (manage=%s decided=%s)', (canManage, isDecided) => {
  render(<MakeContentResult result={{ ...partial, docs: [failedEntry, dismissedEntry] }} onRetry={vi.fn()} onFinish={vi.fn()} canManage={canManage} isDecided={isDecided} />)
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  expect(screen.getByText('pages/2: Dismissed')).toBeTruthy()
})

test('ConfirmDialog finishes through after-content archive once all failures are dismissed', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...partial, docs: [failedEntry] })))
    .mockResolvedValueOnce(entryResponse(dismissedEntry))
    .mockResolvedValueOnce(new Response(JSON.stringify({ doc: { status: 'archived' }, revision: 3 })))
  vi.stubGlobal('fetch', fetcher)
  const action = availableActions({ status: 'decided', kind: 'block', arms: [], canManage: true }).find(item => item.id === 'make-content')!
  render(<ConfirmDialog canManage isDecided id={1} action={action} winnerLabel="Variant A" onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Make it the content' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
  const finish = await screen.findByRole('button', { name: 'Finish archiving' })
  act(() => { finish.click(); finish.click() })
  await waitFor(() => expect(reloadPage).toHaveBeenCalledOnce())
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(fetcher.mock.calls[2]?.[0]).toBe('/api/xp/experiments/1/archive')
  expect(JSON.parse(fetcher.mock.calls[2]?.[1].body)).toEqual({ mode: 'after-content' })
})

test.each([false, true])('already archived make-content response offers Done without Finish (after Retry=%s)', async retry => {
  const archived = { ...partial, doc: { status: 'archived' }, docs: partial.docs.map(entry => ({ ...entry, ok: true })) }
  const fetcher = vi.fn()
  if (retry) fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...partial, doc: { status: 'decided' } })))
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(archived)))
  vi.stubGlobal('fetch', fetcher)
  const action = availableActions({ status: 'decided', kind: 'block', arms: [], canManage: true }).find(item => item.id === 'make-content')!
  render(<ConfirmDialog canManage isDecided id={1} action={action} winnerLabel="Variant A" onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Make it the content' }))
  if (retry) fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.getByText('pages/2: Updated — Someone is editing this page. Wait for them to finish, then retry.')).toBeTruthy())
  expect(screen.queryByRole('button', { name: 'Finish archiving' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
})

test('a refused Finish can be attempted again without reposting make-content', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...partial, doc: { status: 'decided' }, docs: [dismissedEntry] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ code: 'commit-unverified' }] }), { status: 500 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ doc: { status: 'archived' }, revision: 3 })))
  vi.stubGlobal('fetch', fetcher)
  const action = availableActions({ status: 'decided', kind: 'block', arms: [], canManage: true }).find(item => item.id === 'make-content')!
  render(<ConfirmDialog canManage isDecided id={1} action={action} winnerLabel="Variant A" onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Make it the content' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Finish archiving' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Finish archiving' }))
  await waitFor(() => expect(reloadPage).toHaveBeenCalledOnce())
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    '/api/xp/experiments/1/make-content', '/api/xp/experiments/1/archive', '/api/xp/experiments/1/archive',
  ])
})

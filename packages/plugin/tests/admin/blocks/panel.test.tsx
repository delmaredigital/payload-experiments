// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { payloadUiMock, resetPayloadUiMock, setPayloadUiState, toast } from '../_helpers/payloadUiMock.js'
import { configure, field, original } from './fixtures.js'
import { wrapExperimentBlock } from '../../../src/blocks/formState.js'
import { BlockStatusField, BlockSlotRowLabel, CopyOriginalField } from '../../../src/admin/blocks/BlockPanel.js'
import { BlockChangedError } from '../../../src/admin/blocks/formApi.js'
import { setBlockStatus } from '../../../src/admin/blocks/statusCache.js'
import { API_MESSAGES } from '../../../src/admin/copy/common.js'
import { BLOCK_COPY } from '../../../src/admin/copy/blocks.js'
import type { LiveBlockStatus } from '../../../src/admin/blocks/model.js'
const mocks = vi.hoisted(() => ({ adapt: vi.fn(), replace: vi.fn() }))
vi.mock('@payloadcms/ui', () => payloadUiMock())
vi.mock('../../../src/admin/blocks/formApi.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/admin/blocks/formApi.js')>()
  mocks.adapt.mockImplementation(actual.adaptClientBlocksField)
  return { ...actual, adaptClientBlocksField: mocks.adapt, replaceBlockRow: mocks.replace }
})
const props = { path: 'layout.0.xpBlockStatus' } as any
const actionProps = { path: 'layout.0.slots.1.xpCopyOriginal' } as any
const live: LiveBlockStatus = { name: 'Hero', kind: 'block', status: 'running', arms: [{ key: 'control', label: 'Old hero' }, { key: 'variantA', label: 'New hero' }], rollout: false }
let fetch: ReturnType<typeof vi.fn>
beforeEach(() => { resetPayloadUiMock(); mocks.adapt.mockClear(); mocks.replace.mockReset().mockResolvedValue(undefined); fetch = vi.fn(); vi.stubGlobal('fetch', fetch); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(async () => { cleanup(); await Promise.resolve(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function prepare(status: unknown = live, options: { slug?: string; empty?: boolean } = {}) {
  const wrapped = wrapExperimentBlock(original, options.slug ?? 'hero-test', field)
  if (options.empty) wrapped.slots[1]!.blocks = []
  configure({ layout: [wrapped] })
  fetch.mockResolvedValue({ ok: true, json: async () => ({ slugs: { [wrapped.experiment]: status }, docs: {} }) })
  return wrapped
}
function all() { return <><BlockStatusField {...props} /><BlockSlotRowLabel /><CopyOriginalField {...actionProps} /></> }
test('one request shared by status, label, action; remount refetches new arms', async () => {
  prepare(); const view = render(all())
  expect(await screen.findByText('New hero')).toBeTruthy()
  expect(screen.getAllByText(BLOCK_COPY.running)).toHaveLength(1)
  expect(fetch).toHaveBeenCalledOnce(); expect(screen.getByText(BLOCK_COPY.copy)).toBeTruthy()
  view.unmount(); await act(async () => { await Promise.resolve() })
  fetch.mockResolvedValue({ ok: true, json: async () => ({ slugs: { 'hero-test': { ...live, arms: [{ key: 'variantA', label: 'Changed hero' }] } } }) })
  render(all()); expect(await screen.findByText('Changed hero')).toBeTruthy(); expect(fetch).toHaveBeenCalledTimes(2)
})
test.each(['draft', 'stopped'] as const)('sync %s waits for initialization, runs once in StrictMode, adds/drops/reorders and notices only changes', async status => {
  const block = prepare({ ...live, status, arms: [{ key: 'variantB', label: 'Third' }, { key: 'control', label: 'Original' }, { key: 'holdout', label: 'Holdout' }] })
  setPayloadUiState({ formInitializing: true })
  render(<StrictMode>{all()}</StrictMode>)
  await screen.findByText(status === 'draft' ? 'This block is being tested in the draft test Hero. Visitors see the Original until it starts.' : BLOCK_COPY.stopped)
  expect(mocks.replace).not.toHaveBeenCalled()
  act(() => setPayloadUiState({ formInitializing: false }))
  expect(await screen.findByText('Versions were updated to match the test. Save draft to keep them.')).toBeTruthy()
  expect(mocks.replace).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce()
  const next = mocks.replace.mock.calls[0]![0].rows[0]
  expect(next.slots.map((row: any) => row.slot)).toEqual(['variantB', 'control'])
  expect(next.slots[0].blocks[0].id).not.toBe(block.slots[0]!.blocks[0]!.id)
  act(() => setPayloadUiState({ formInitializing: false }))
  expect(mocks.replace).toHaveBeenCalledOnce()
})
test('unchanged slots show no sync notice', async () => {
  prepare({ ...live, status: 'draft' }); render(all()); await screen.findByText('New hero')
  expect(mocks.replace).not.toHaveBeenCalled(); expect(screen.queryByText(/Versions were updated/)).toBeNull()
})
test.each(['running', 'decided', 'archived'] as const)('no sync for %s even when arms differ', async status => {
  prepare({ ...live, status, winnerArm: 'control', arms: [{ key: 'control', label: 'Old hero' }, { key: 'variantB', label: 'Third' }] })
  render(all()); await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); await act(async () => { await Promise.resolve() })
  expect(mocks.replace).not.toHaveBeenCalled(); expect(screen.queryByText(/Versions were updated/)).toBeNull()
})
test.each(['', 'x'.repeat(65)])('invalid slug %s has slot-only label, no status/sync/Unwrap/action/request', async slug => {
  prepare({ deleted: true }, { slug }); const view = render(all())
  expect(view.container.textContent).toBe('Variant A'); expect(fetch).not.toHaveBeenCalled(); expect(mocks.replace).not.toHaveBeenCalled()
})
test.each([403, 422, 0])('read failure %s renders only slot label', async status => {
  prepare(); if (status) fetch.mockResolvedValue({ ok: false, status, json: async () => ({}) }); else fetch.mockRejectedValue(new Error('network'))
  const view = render(all()); await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); await act(async () => { await Promise.resolve() })
  expect(view.container.textContent).toBe('Variant A'); expect(mocks.replace).not.toHaveBeenCalled()
})
test.each([{ deleted: true }, { missing: true }, { ...live, status: 'archived' }])('orphans offer Unwrap only to managers; fresh ids', async status => {
  prepare(status); render(all()); const button = await screen.findByText(BLOCK_COPY.unwrap)
  fireEvent.click(button); await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce())
  expect(mocks.replace.mock.calls[0]![0].rows[0].id).not.toBe(original.id)
  expect(toast.success).toHaveBeenCalledExactlyOnceWith('The block was unwrapped. Save draft to keep it.')
  act(() => setPayloadUiState({ auth: { permissions: { collections: {} } } }))
  expect(screen.queryByText(BLOCK_COPY.unwrap)).toBeNull()
})
test.each(['draft', 'stopped', 'running', 'decided', 'archived'] as const)('copy action visibility for %s', async status => {
  prepare({ ...live, status, winnerArm: 'variantA' }); render(all()); await screen.findByText('New hero')
  expect(Boolean(screen.queryByText(BLOCK_COPY.copy))).toBe(['draft', 'stopped', 'running'].includes(status))
  expect(Boolean(screen.queryByRole('button', { name: BLOCK_COPY.unwrap }))).toBe(status === 'stopped')
})
test.each([true, false])('copy uses Payload confirmation only for populated rows (empty=%s)', async empty => {
  prepare(live, { empty })
  render(all()); const button = await screen.findByText(BLOCK_COPY.copy); fireEvent.click(button)
  if (!empty) {
    expect(screen.getByRole('dialog').textContent).toContain(BLOCK_COPY.confirmCopy)
    expect(mocks.replace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.replace).not.toHaveBeenCalled()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.replace }))
  } else expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce())
  const copied = mocks.replace.mock.calls[0]![0].rows[0].slots[1].blocks[0]
  expect(copied.id).not.toBe(original.id); expect(copied.items[0].id).not.toBe('nested-array')
})
test('sync notice for collections without drafts says Save', async () => {
  prepare({ ...live, status: 'stopped', arms: [{ key: 'control', label: 'Original' }] })
  setPayloadUiState({ entityConfig: { slug: 'pages', fields: [field], versions: false } })
  render(all()); expect(await screen.findByText('Versions were updated to match the test. Save to keep them.')).toBeTruthy()
})
test('Original row has no copy action', async () => {
  prepare(); setPayloadUiState({ rowLabel: { path: 'layout.0.slots.0', data: { slot: 'control' } } })
  render(<><BlockStatusField {...props} /><CopyOriginalField {...{ ...actionProps, path: 'layout.0.slots.0.xpCopyOriginal' }} /></>)
  await screen.findByText(BLOCK_COPY.running); expect(screen.queryByText(BLOCK_COPY.copy)).toBeNull()
})

test('each copy row has a stable unique modal slug', async () => {
  prepare({ ...live, arms: [...live.arms, { key: 'variantB', label: 'Third' }] })
  render(<><BlockStatusField {...props} /><CopyOriginalField {...actionProps} /><CopyOriginalField {...actionProps} /></>)
  const buttons = await screen.findAllByText(BLOCK_COPY.copy)
  fireEvent.click(buttons[0]!)
  const first = screen.getByRole('dialog').getAttribute('data-modal-slug')
  fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.cancel }))
  fireEvent.click(buttons[1]!)
  expect(screen.getByRole('dialog').getAttribute('data-modal-slug')).not.toBe(first)
  fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.cancel }))
  fireEvent.click(buttons[0]!)
  expect(screen.getByRole('dialog').getAttribute('data-modal-slug')).toBe(first)
})
test.each(['draft', 'stopped'] as const)('failed %s sync offers a working retry', async status => {
  prepare({ ...live, status, arms: [{ key: 'control', label: 'Original' }] })
  mocks.replace.mockRejectedValueOnce(new Error())
  render(all())
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', API_MESSAGES.failed)
  expect(mocks.replace).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.retry }))
  expect(await screen.findByText('Versions were updated to match the test. Save draft to keep them.')).toBeTruthy()
  expect(mocks.replace).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(BLOCK_COPY.retry)).toBeNull()
})
test('failed sync retry remains manage gated', async () => {
  prepare({ ...live, status: 'draft', arms: [{ key: 'control', label: 'Original' }] })
  mocks.replace.mockRejectedValueOnce(new Error()); render(all())
  await screen.findByRole('button', { name: BLOCK_COPY.retry })
  act(() => setPayloadUiState({ auth: { permissions: { collections: {} } } }))
  expect(screen.queryByRole('button', { name: BLOCK_COPY.retry })).toBeNull()
  expect(mocks.replace).toHaveBeenCalledOnce()
})
test('same-commit owner replacement makes exactly one fresh read under StrictMode', async () => {
  prepare()
  const view = render(<StrictMode><BlockStatusField key="first" {...props} /><BlockSlotRowLabel /></StrictMode>)
  await screen.findByText('New hero'); expect(fetch).toHaveBeenCalledOnce()
  fetch.mockResolvedValue({ ok: true, json: async () => ({ slugs: { 'hero-test': { ...live, arms: [{ key: 'variantA', label: 'Fresh hero' }] } } }) })
  view.rerender(<StrictMode><BlockStatusField key="second" {...props} /><BlockSlotRowLabel /></StrictMode>)
  expect(await screen.findByText('Fresh hero')).toBeTruthy(); expect(fetch).toHaveBeenCalledTimes(2)
})
test('labels alone own no read; losing the last owner evicts status while a label stays mounted', async () => {
  prepare()
  const view = render(<BlockSlotRowLabel />)
  expect(view.container.textContent).toBe('Variant A'); expect(fetch).not.toHaveBeenCalled()
  view.rerender(<><BlockSlotRowLabel /><BlockStatusField {...props} /></>)
  await screen.findByText('New hero'); expect(fetch).toHaveBeenCalledOnce()
  view.rerender(<><BlockSlotRowLabel /></>)
  await waitFor(() => expect(view.container.textContent).toBe('Variant A'))
  fetch.mockResolvedValue({ ok: true, json: async () => ({ slugs: { 'hero-test': { ...live, arms: [{ key: 'variantA', label: 'Fresh hero' }] } } }) })
  view.rerender(<><BlockSlotRowLabel /><BlockStatusField {...props} /></>)
  await screen.findByText('Fresh hero'); expect(fetch).toHaveBeenCalledTimes(2)
})

test('typing elsewhere does not re-adapt panel, label or action configs', async () => {
  prepare(); render(all()); await screen.findByText('New hero')
  expect(mocks.adapt).toHaveBeenCalledTimes(3)
  act(() => setPayloadUiState({ formFields: { title: { value: 'New title' } } }))
  expect(mocks.adapt).toHaveBeenCalledTimes(3)
})
test('two live owners share one request through StrictMode replay', async () => {
  prepare(); render(<StrictMode><BlockStatusField {...props} /><BlockStatusField {...props} /><BlockSlotRowLabel /></StrictMode>)
  await screen.findByText('New hero'); expect(fetch).toHaveBeenCalledOnce()
})

test.each(['running', 'decided', 'archived'] as const)('failed sync cannot retry after the test becomes %s', async nextStatus => {
  const status: LiveBlockStatus = { ...live, status: 'draft', arms: [{ key: 'control', label: 'Original' }] }
  prepare(status); mocks.replace.mockRejectedValueOnce(new Error())
  const view = render(all()); await screen.findByRole('button', { name: BLOCK_COPY.retry })
  status.status = nextStatus
  view.rerender(all())
  expect(screen.queryByRole('button', { name: BLOCK_COPY.retry })).toBeNull()
  expect(mocks.replace).toHaveBeenCalledOnce()
})

test.each(['draft', 'stopped'] as const)('same-commit %s owner replacement syncs only fresh arms', async status => {
  prepare({ ...live, status })
  const view = render(<BlockStatusField key="old" {...props} />)
  await screen.findByText(status === 'draft' ? 'This block is being tested in the draft test Hero. Visitors see the Original until it starts.' : BLOCK_COPY.stopped)
  expect(mocks.replace).not.toHaveBeenCalled()
  let respond!: (value: unknown) => void
  fetch.mockImplementationOnce(() => new Promise(resolve => { respond = resolve }))
  view.rerender(<BlockStatusField key="new" {...props} />)
  expect(fetch).toHaveBeenCalledTimes(2); expect(mocks.replace).not.toHaveBeenCalled()
  await act(async () => respond({ ok: true, json: async () => ({ slugs: { 'hero-test': { ...live, status, arms: [{ key: 'control', label: 'Original' }, { key: 'variantB', label: 'Fresh version' }] } } }) }))
  await screen.findByText('Versions were updated to match the test. Save draft to keep them.')
  expect(mocks.replace).toHaveBeenCalledOnce()
  expect(mocks.replace.mock.calls[0]![0].rows[0].slots.map((row: any) => row.slot)).toEqual(['control', 'variantB'])
})

async function confirmUnwrap(draft: boolean) {
  fireEvent.click(await screen.findByRole('button', { name: draft ? BLOCK_COPY.removeAndUnwrap : BLOCK_COPY.unwrap }))
  const dialog = screen.getByRole('dialog')
  expect(dialog.getAttribute('aria-label')).toBe(draft ? BLOCK_COPY.removeAndUnwrap : BLOCK_COPY.unwrap)
  expect(dialog.textContent).toContain(draft
    ? "Delete the draft test Hero and put the Original back in its place? Deleting the test can't be undone."
    : "Put the Original back in this block's place? The test Hero and its results are kept; it can't be started again.")
  expect(mocks.replace).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: draft ? BLOCK_COPY.deleteAndUnwrap : BLOCK_COPY.unwrap }))
}
function respondDelete(lookup: unknown = { docs: [{ id: 'test /?' }] }, deletion: unknown = {}, status = 200) {
  fetch.mockResolvedValueOnce(Response.json(lookup))
  fetch.mockResolvedValueOnce(Response.json(deletion, { status }))
}
test.each([true, false])('draft delete precedes replace, updates cache for labels, and toasts (drafts=%s)', async drafts => {
  prepare({ ...live, status: 'draft' })
  if (!drafts) setPayloadUiState({ entityConfig: { slug: 'pages', fields: [field], versions: false } })
  render(all()); await screen.findByText('New hero')
  respondDelete()
  mocks.replace.mockImplementation(async () => {
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('New hero')).toBeNull()
  })
  await confirmUnwrap(true)
  await waitFor(() => expect(toast.success).toHaveBeenCalledExactlyOnceWith(`The draft test was deleted and the block unwrapped. ${drafts ? 'Save draft' : 'Save'} to keep it.`))
  expect(mocks.replace).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[1]![0]).toBe('/api/xp-experiments?where[slug][equals]=hero-test&depth=0&limit=1')
  expect(fetch.mock.calls[2]).toEqual(['/api/xp-experiments/test%20%2F%3F', { method: 'DELETE', credentials: 'include' }])
})
test.each([
  [{ docs: [] }, {}, 200, 'This test was already deleted. Reload the page.', 2],
  [{ docs: [{ id: 4 }] }, { errors: [{ message: 'You are not allowed to perform this action.' }] }, 403, 'This test is no longer a draft. Reload the page.', 3],
  [{ docs: [{ id: 4 }] }, {}, 404, 'This test is no longer a draft. Reload the page.', 3],
  [{ docs: [{ id: 4 }] }, { errors: [{ code: 'invalid-status', message: 'Only draft or archived tests can be deleted.' }] }, 409, 'This test is no longer a draft. Reload the page.', 3],
  [{ docs: [{ id: 4 }] }, { errors: [{ message: 'This page is locked.' }] }, 409, 'This page is locked.', 3],
  [{ docs: [{ id: 4 }] }, {}, 500, API_MESSAGES.failed, 3],
] as const)('draft refusal %s replaces nothing and displays the API message', async (lookup, deletion, status, message, calls) => {
  prepare({ ...live, status: 'draft' }); render(all()); await screen.findByText('New hero')
  respondDelete(lookup, deletion, status)
  await confirmUnwrap(true)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', message)
  expect(mocks.replace).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(calls)
})
test('a draft that starts before confirmation is refused without unwrapping or marking the cache deleted', async () => {
  let serverStatus: LiveBlockStatus['status'] = 'draft'
  prepare({ ...live, status: serverStatus }); render(all()); await screen.findByText('New hero')
  fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.removeAndUnwrap }))
  serverStatus = 'running'
  fetch.mockImplementation(async (_url, options) => options.method === 'DELETE'
    ? Response.json({ errors: [{ message: 'You are not allowed to perform this action.' }] }, { status: serverStatus === 'running' ? 403 : 200 })
    : Response.json({ docs: [{ id: 4, status: serverStatus }] }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: BLOCK_COPY.deleteAndUnwrap }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', BLOCK_COPY.noLongerDraft)
  expect(fetch.mock.calls.slice(1)).toEqual([
    ['/api/xp-experiments?where[slug][equals]=hero-test&depth=0&limit=1', { method: 'GET', credentials: 'include' }],
    ['/api/xp-experiments/4', { method: 'DELETE', credentials: 'include' }],
  ])
  expect(mocks.replace).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
  expect(screen.getByText('New hero')).toBeTruthy()
  expect(screen.getByRole('button', { name: BLOCK_COPY.removeAndUnwrap })).toBeTruthy()
  expect(screen.queryByText(BLOCK_COPY.deleted)).toBeNull()
})
test('replacement failure after deleting a draft shows the exact retry message and orphan Unwrap', async () => {
  prepare({ ...live, status: 'draft' }); render(all()); await screen.findByText('New hero')
  respondDelete(); mocks.replace.mockRejectedValueOnce(new BlockChangedError())
  await confirmUnwrap(true)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The test was removed; use Unwrap to finish.')
  expect(screen.queryByRole('button', { name: BLOCK_COPY.removeAndUnwrap })).toBeNull()
  expect(screen.getByText(BLOCK_COPY.deleted)).toBeTruthy()
  expect(toast.success).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.unwrap }))
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(2))
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(toast.success).toHaveBeenCalledWith('The block was unwrapped. Save draft to keep it.')
  expect(screen.queryByRole('alert')).toBeNull()
})
test.each([true, false])('stopped confirmation preserves the test, replaces then toasts (drafts=%s)', async drafts => {
  prepare({ ...live, status: 'stopped' })
  if (!drafts) setPayloadUiState({ entityConfig: { slug: 'pages', fields: [field], versions: false } })
  render(all()); await screen.findByText('New hero')
  mocks.replace.mockImplementation(async () => expect(toast.success).not.toHaveBeenCalled())
  await confirmUnwrap(false)
  await waitFor(() => expect(toast.success).toHaveBeenCalledExactlyOnceWith(`The block was unwrapped. ${drafts ? 'Save draft' : 'Save'} to keep it.`))
  expect(mocks.replace).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce()
})
test.each([
  ['running', 'Stop the test to unwrap.'],
  ['decided', 'To put the winner into this page, use "Make it the content" on the test.'],
  ['archived', 'Finished: visitors see New hero. Use "Make it the content" on the test to replace this block.'],
] as const)('%s gives a linked sentence with no Unwrap action', async (status, sentence) => {
  prepare({ ...live, status, winnerArm: 'variantA' }, { slug: 'hero /?' })
  render(<BlockStatusField {...props} />)
  const link = await screen.findByRole('link', { name: 'the test' })
  expect(link.getAttribute('href')).toBe('/cms/experiments/by-slug/hero%20%2F%3F')
  expect(link.parentElement?.textContent).toBe(sentence)
  expect(screen.queryByRole('button')).toBeNull()
  if (status === 'running') expect(screen.getByRole('status').textContent).toBe(BLOCK_COPY.running)
  if (status === 'decided') expect(screen.getByText('Decided: visitors see New hero.')).toBeTruthy()
})
test('non-managers see no status, sentences, actions or links', async () => {
  prepare(); setPayloadUiState({ auth: { permissions: { collections: {} } } })
  fetch.mockResolvedValue(Response.json({ slugs: {}, docs: {} }, { status: 403 }))
  const view = render(<BlockStatusField {...props} />)
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  expect(view.container.textContent).toBe(''); expect(screen.queryByRole('link')).toBeNull()
})
test.each(['copy', 'sync', 'orphan unwrap', 'stopped unwrap'] as const)('%s shows known errors and hides developer error text', async path => {
  const status = path === 'sync' || path === 'stopped unwrap' ? { ...live, status: 'stopped', arms: path === 'sync' ? [{ key: 'control', label: 'Original' }] : live.arms }
    : path === 'orphan unwrap' ? { deleted: true } : live
  prepare(status, { empty: true })
  const specific = new BlockChangedError()
  mocks.replace.mockRejectedValueOnce(specific).mockRejectedValueOnce(new Error('Missing server form state'))
  render(all())
  if (path === 'copy') fireEvent.click(await screen.findByText(BLOCK_COPY.copy))
  else if (path === 'orphan unwrap') fireEvent.click(await screen.findByRole('button', { name: BLOCK_COPY.unwrap }))
  else if (path === 'stopped unwrap') await confirmUnwrap(false)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', specific.message)
  if (path === 'copy') fireEvent.click(screen.getByText(BLOCK_COPY.copy))
  else if (path === 'orphan unwrap') fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.unwrap }))
  else if (path === 'stopped unwrap') {
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.unwrap }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: BLOCK_COPY.unwrap }))
  } else fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.retry }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(API_MESSAGES.failed))
  expect(screen.queryByText('Missing server form state')).toBeNull()
})
test('explicit cache update publishes to owners and labels without another read', async () => {
  prepare(); render(all()); await screen.findByText('New hero')
  act(() => setBlockStatus('/api', 'hero-test', { deleted: true }))
  expect(screen.getByText(BLOCK_COPY.deleted)).toBeTruthy()
  expect(screen.getByText('Variant A')).toBeTruthy()
  expect(screen.queryByText('New hero')).toBeNull()
  expect(fetch).toHaveBeenCalledOnce()
})
test('a stale pending status read cannot overwrite the deletion cache entry', async () => {
  prepare()
  let respond!: (response: Response) => void
  fetch.mockImplementationOnce(() => new Promise(resolve => { respond = resolve }))
  render(all())
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  act(() => setBlockStatus('/api', 'hero-test', { deleted: true }))
  await act(async () => respond(Response.json({ slugs: { 'hero-test': live } })))
  expect(screen.getByText(BLOCK_COPY.deleted)).toBeTruthy()
  expect(screen.getByText('Variant A')).toBeTruthy()
})

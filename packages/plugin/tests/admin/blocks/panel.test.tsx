// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { payloadUiMock, resetPayloadUiMock, setPayloadUiState } from '../_helpers/payloadUiMock.js'
import { configure, field, original } from './fixtures.js'
import { wrapExperimentBlock } from '../../../src/blocks/formState.js'
import { BlockStatusField, BlockSlotRowLabel, CopyOriginalField } from '../../../src/admin/blocks/BlockPanel.js'
import { BLOCK_COPY } from '../../../src/admin/copy/blocks.js'
import type { LiveBlockStatus } from '../../../src/admin/blocks/model.js'
const mocks = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('@payloadcms/ui', () => payloadUiMock())
vi.mock('../../../src/admin/blocks/formApi.js', async importOriginal => ({ ...await importOriginal<typeof import('../../../src/admin/blocks/formApi.js')>(), replaceBlockRow: mocks.replace }))
const props = { path: 'layout.0.xpBlockStatus' } as any
const actionProps = { path: 'layout.0.slots.1.xpCopyOriginal' } as any
const live: LiveBlockStatus = { name: 'Hero', kind: 'block', status: 'running', arms: [{ key: 'control', label: 'Old hero' }, { key: 'variantA', label: 'New hero' }], rollout: false }
let fetch: ReturnType<typeof vi.fn>
beforeEach(() => { resetPayloadUiMock(); mocks.replace.mockReset().mockResolvedValue(undefined); fetch = vi.fn(); vi.stubGlobal('fetch', fetch) })
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
  act(() => setPayloadUiState({ auth: { permissions: { collections: {} } } }))
  expect(screen.queryByText(BLOCK_COPY.unwrap)).toBeNull()
})
test.each(['draft', 'stopped', 'running', 'decided', 'archived'] as const)('copy action visibility for %s', async status => {
  prepare({ ...live, status, winnerArm: 'variantA' }); render(all()); await screen.findByText('New hero')
  expect(Boolean(screen.queryByText(BLOCK_COPY.copy))).toBe(['draft', 'stopped', 'running'].includes(status))
})
test.each([true, false])('copy confirms only when existing row has content (empty=%s)', async empty => {
  prepare(live, { empty }); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(all()); const button = await screen.findByText(BLOCK_COPY.copy); fireEvent.click(button)
  if (!empty) { expect(confirm).toHaveBeenCalledOnce(); expect(mocks.replace).not.toHaveBeenCalled(); confirm.mockReturnValue(true); fireEvent.click(button) }
  else expect(confirm).not.toHaveBeenCalled()
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

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ExperimentKind } from '../../../../src/types/contracts.js'
import { DeleteTest } from '../../../../src/testSurface/surface/test/DeleteTest.js'
import { DELETE_TEST } from '../../../../src/testSurface/copy/testPage.js'
import { API_MESSAGES } from '../../../../src/testSurface/copy/common.js'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const base = { test: { id: 42, name: 'Welcome test', status: 'draft', kind: 'block' as const }, canManage: true, apiRoute: '/data', onDeleted: vi.fn() }
test.each(['draft', 'archived', 'running', 'stopped', 'decided'])('delete mirrors the guard in %s', status => {
  render(<DeleteTest {...base} test={{ ...base.test, status }} />)
  expect(Boolean(screen.queryByRole('button', { name: 'Delete test' }))).toBe(['draft', 'archived'].includes(status))
})
test('readers never see delete', () => {
  render(<DeleteTest {...base} canManage={false} />)
  expect(screen.queryByRole('button')).toBeNull()
})
test('confirmation names the test and its consequences; cancel deletes nothing and returns focus', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  render(<DeleteTest {...base} />)
  const trigger = screen.getByRole('button', { name: 'Delete test' }); trigger.focus(); fireEvent.click(trigger)
  expect(screen.getByRole('dialog').textContent).toContain('Welcome test')
  expect(screen.getByRole('dialog').textContent).toContain('results')
  expect(screen.getByRole('dialog').textContent).toContain('page content')
  expect(screen.getByRole('dialog').textContent).toContain('was deleted')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull(); expect(fetch).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(trigger)
})
test.each([200, 404])('confirmed delete handles HTTP %s and reports completion', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })))
  const onDeleted = vi.fn()
  render(<DeleteTest {...base} onDeleted={onDeleted} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete test' }))
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(status === 404 ? 'already' : 'done'))
  expect(fetch).toHaveBeenCalledWith('/data/xp-experiments/42', expect.objectContaining({ method: 'DELETE', credentials: 'include' }))
})
test('server refusal stays visible in the confirmation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ code: 'invalid-status', message: 'This action is not available in the current status.' }] }), { status: 409 })))
  const onDeleted = vi.fn()
  render(<DeleteTest {...base} onDeleted={onDeleted} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete test' }))
  expect((await screen.findByRole('alert')).textContent).toBe(API_MESSAGES.deleteInvalidStatus)
  expect(onDeleted).not.toHaveBeenCalled()
})


const done = { collection: 'pages', id: 1, ok: true }
const dismissed = { collection: 'pages', id: 2, ok: false, dismissedAt: 'date', title: 'Welcome', path: '/welcome' }
const failed = { collection: 'pages', id: 3, ok: false }
test.each<[ExperimentKind, string, NonNullable<Parameters<typeof DeleteTest>[0]['test']['decision']>, 'blockWinner' | 'pageWinner' | undefined]>([
  ['block', 'archived', { winnerArm: 'control', contentReport: { docs: [dismissed] } }, undefined],
  ['block', 'archived', { winnerArm: 'variantA', contentReport: { docs: [done] } }, undefined],
  ['block', 'archived', { winnerArm: 'variantA', contentReport: { docs: [] } }, undefined],
  ['block', 'archived', { winnerArm: 'variantA' }, undefined],
  ['block', 'archived', { winnerArm: 'variantA', contentReport: { docs: [done, dismissed] } }, 'blockWinner'],
  ['block', 'archived', { winnerArm: 'variantA', contentReport: { docs: [failed] } }, 'blockWinner'],
  ['block', 'archived', { winnerArm: 'variantA', contentReport: [dismissed] }, 'blockWinner'],
  ['block', 'archived', { winnerArm: 'variantA', contentReport: { docs: [dismissed] }, discardedAt: 'date' }, undefined],
  ['page', 'archived', { winnerArm: 'variantA' }, 'pageWinner'],
  ['page', 'archived', { winnerArm: 'control' }, 'pageWinner'],
  ['page', 'archived', { winnerArm: 'variantA', discardedAt: 'date' }, undefined],
  ['page', 'archived', { winnerArm: 'variantA', pagesReleasedAt: 'date' }, undefined],
  ['page', 'archived', { winnerArm: 'control', pagesReleasedAt: 'date' }, undefined],
  ['block', 'archived', {}, undefined], ['page', 'archived', {}, undefined],
  ['block', 'draft', { winnerArm: 'variantA', contentReport: { docs: [dismissed] } }, undefined],
  ['page', 'draft', { winnerArm: 'variantA' }, undefined],
  ['flag', 'archived', { winnerArm: 'variantA' }, undefined],
  ['code', 'archived', { winnerArm: 'variantA' }, undefined],
])('delete consequences for %s / %s / %j', (kind, status, decision, warning) => {
  render(<DeleteTest {...base} test={{ ...base.test, kind, status, decision }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  const dialog = screen.getByRole('dialog')
  for (const key of ['blockWinner', 'pageWinner'] as const) {
    expect(dialog.textContent?.includes(DELETE_TEST[key])).toBe(key === warning)
  }
  expect(dialog.textContent).not.toContain('Make it the content')
  expect(dialog.textContent).not.toMatch(/nothing changes|does not affect visitors/i)
})
test('block warning names only unresolved places, using available titles and paths or document identifiers', () => {
  render(<DeleteTest {...base} test={{ ...base.test, status: 'archived', decision: { winnerArm: 'variantA', contentReport: { docs: [done, dismissed, failed] } } }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  const places = within(screen.getByRole('dialog')).getAllByRole('listitem').map(item => item.textContent)
  expect(places).toEqual(['Welcome (/welcome)', 'pages/3'])
})
test('busy delete retains focus and suppresses duplicate requests', async () => {
  let resolve!: (response: Response) => void
  const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done })); vi.stubGlobal('fetch', fetch)
  render(<DeleteTest {...base} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  const button = within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', { name: 'Delete test' })
  button.focus(); fireEvent.click(button)
  expect(button.disabled).toBe(false); expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(button.getAttribute('aria-busy')).toBe('true'); expect(document.activeElement).toBe(button)
  fireEvent.click(button); expect(fetch).toHaveBeenCalledTimes(1)
  resolve(Response.json({})); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

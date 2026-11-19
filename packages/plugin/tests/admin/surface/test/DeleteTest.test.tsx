// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DeleteTest } from '../../../../src/testSurface/surface/test/DeleteTest.js'
import { API_MESSAGES } from '../../../../src/testSurface/copy/common.js'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const base = { test: { id: 42, name: 'Welcome test', status: 'draft' }, canManage: true, apiRoute: '/data', onDeleted: vi.fn() }
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
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(status === 404 ? API_MESSAGES.testAlreadyDeleted : 'Test deleted.'))
  expect(fetch).toHaveBeenCalledWith('/data/xp-experiments/42', expect.objectContaining({ method: 'DELETE', credentials: 'include' }))
})
test('server refusal stays visible in the confirmation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ code: 'invalid-status', message: 'This action is not available in the current status.' }] }), { status: 409 })))
  const onDeleted = vi.fn()
  render(<DeleteTest {...base} onDeleted={onDeleted} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete test' }))
  expect((await screen.findByRole('alert')).textContent).toBe('This action is not available in the current status.')
  expect(onDeleted).not.toHaveBeenCalled()
})

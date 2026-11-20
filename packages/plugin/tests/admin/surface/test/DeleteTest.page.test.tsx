// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { props } from '../readiness/fixtures.js'
import { TestPage } from '../../../../src/admin/surface/test/TestPage.js'
vi.mock('@payloadcms/ui', async () => (await import('../../_helpers/payloadUiMock.js')).payloadUiMock())
const hook = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/testSurface/surface/useTestDocument.js', () => ({ useTestDocument: hook }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('test-page delete sits inside measured footer clearance, away from Start', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ docs: [] })))
  const p = props()
  hook.mockReturnValue({ ...p.test, loadState: 'ready', errors: {}, chosenPages: {} })
  render(<TestPage id={p.test.doc!.id} surface={p.surface} />)
  const action = screen.getByRole('button', { name: 'Delete test' })
  expect(action.closest('.xp-test-page--setup')).toBeTruthy()
  expect(action.closest('.xp-test-content')).toBeTruthy()
  expect(action.closest('.xp-test-readiness-bar')).toBeNull()
})


test.each([200, 404])('test-page delete returns to the list with its confirmation (HTTP %s)', async status => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  const navigate = vi.fn(), original = window
  vi.stubGlobal('window', new Proxy(original, { get(target, key) { return key === 'location' ? { ...target.location, assign: navigate } : Reflect.get(target, key) } }))
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'DELETE' ? new Response('{}', { status }) : Response.json({ docs: [] })))
  const p = props()
  hook.mockReturnValue({ ...p.test, loadState: 'ready', errors: {}, chosenPages: {} })
  render(<TestPage id={p.test.doc!.id} surface={p.surface} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', { name: 'Delete test' }).disabled).toBe(false))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete test' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/admin/collections/xp-experiments?deleted=${status === 404 ? 'already' : 'done'}`))
})

test('test page passes the selected content language to the delete check', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  const fetch = vi.fn(async () => Response.json({ effect: 'none' })); vi.stubGlobal('fetch', fetch)
  const p = props(); hook.mockReturnValue({ ...p.test, loadState: 'ready', errors: {}, chosenPages: {} })
  render(<TestPage id={p.test.doc!.id} surface={{ ...p.surface, contentLocale: 'fr' }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete test' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(`${p.surface.apiRoute}/xp/experiments/${p.test.doc!.id}/delete-impact?locale=fr`, expect.objectContaining({ method: 'GET' })))
})

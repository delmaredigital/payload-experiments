// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MakeContentResult } from '../../../src/admin/actions/MakeContentResult.js'
import { ConfirmDialog } from '../../../src/admin/actions/ConfirmDialog.js'
import { availableActions } from '../../../src/admin/actions/actions.model.js'
import { reloadPage } from '../../../src/admin/reload.js'
import { resetPayloadUiMock } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
vi.mock('../../../src/admin/reload.js', () => ({ reloadPage: vi.fn() }))
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const partial = { doc: {}, revision: 2, docs: [
  { collection: 'pages', id: 1, ok: true, title: 'Home' },
  { collection: 'pages', id: 2, ok: false, error: 'Locked by an editor' },
] }
test('partial failure lists document titles or references, results and retry', () => {
  const retry = vi.fn()
  render(<MakeContentResult result={partial} onRetry={retry} />)
  expect(screen.getByText('Home: Updated')).toBeTruthy()
  expect(screen.getByText('pages/2: Failed — Locked by an editor')).toBeTruthy()
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
  render(<ConfirmDialog id={1} action={action} winnerLabel="Variant A" onClose={vi.fn()} />)
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

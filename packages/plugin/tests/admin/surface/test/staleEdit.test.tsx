// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TestPage } from '../../../../src/admin/surface/test/TestPage.js'
import { SaveStatus } from '../../../../src/admin/surface/readiness/SaveStatus.js'
import { READINESS_COPY } from '../../../../src/admin/copy/readiness.js'
import { TEST_PAGE } from '../../../../src/admin/copy/testPage.js'
import { doc, preflight, props } from '../readiness/fixtures.js'

vi.mock('../../../../src/admin/surface/readiness/parts.js', async () => ({ readinessParts: {
  Banner: () => null, SaveStatus: (await import('../../../../src/admin/surface/readiness/SaveStatus.js')).SaveStatus,
  sectionDone: () => ({ what: false, versions: false, win: false, who: true, length: false, advanced: true }),
} }))
vi.mock('../../../../src/admin/surface/setting/parts.js', () => ({ settingParts: { Binding: () => null, VersionContent: () => null } }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('a stale edit shows one alert with Reload, preserves typed values, and Reload discards them', async () => {
  let refuse!: (value: Response) => void
  const refusal = new Promise<Response>(resolve => { refuse = resolve })
  const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body }) as Response
  let reads = 0
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/click-keys')) return response({ keys: [] })
    if (url.endsWith('/preflight')) return response(preflight())
    if (url.includes('/xp-metrics')) return response({ docs: [], hasNextPage: false })
    if (init?.method === 'PATCH') return refusal
    if (url === `/custom-api/xp-experiments/${encodeURIComponent(String(doc.id))}?depth=0`) return response({ ...doc, updatedAt: `2026-11-03T10:0${reads}:00.000Z`, name: ++reads === 1 ? 'Loaded name' : 'Newer saved name' })
    throw new Error(`Unrouted request: ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)
  await act(async () => { render(<TestPage id={doc.id} surface={props().surface} />) })
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Test name').value).toBe('Loaded name'))
  fireEvent.change(screen.getByLabelText('Test name'), { target: { value: 'My typed name' } })
  fireEvent.blur(screen.getByLabelText('Test name'))
  fireEvent.change(screen.getByLabelText('Why are you testing this? (optional)'), { target: { value: 'Queued hypothesis' } })
  fireEvent.blur(screen.getByLabelText('Why are you testing this? (optional)'))
  const patches = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')
  await waitFor(() => expect(patches()).toHaveLength(1))
  const message = TEST_PAGE.staleEdit
  const serverText = 'Experiment 42 updatedAt mismatch (server)'
  await act(async () => { refuse(response({ errors: [{ code: 'stale-edit', message: serverText }] }, 409)) })
  const notice = await screen.findByRole('alert')
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(notice.classList.contains('xp-ui-banner--error')).toBe(true)
  expect(notice.compareDocumentPosition(document.getElementById('section-what')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(notice).getByText(message)).toBeTruthy()
  expect(document.body.textContent).not.toContain(serverText)
  expect(screen.queryByText(READINESS_COPY.saveError)).toBeNull()
  expect(screen.getByLabelText<HTMLInputElement>('Test name').value).toBe('My typed name')
  expect(screen.getByLabelText<HTMLTextAreaElement>('Why are you testing this? (optional)').value).toBe('Queued hypothesis')
  fireEvent.change(screen.getByLabelText('Test name'), { target: { value: 'Still typing' } })
  fireEvent.blur(screen.getByLabelText('Test name'))
  await act(async () => {})
  expect(patches()).toHaveLength(1)
  fireEvent.click(within(notice).getByRole('button', { name: 'Reload' }))
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Test name').value).toBe('Newer saved name'))
  expect(reads).toBe(2)
  expect(screen.queryByText(message)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  expect(screen.getByLabelText<HTMLTextAreaElement>('Why are you testing this? (optional)').value).toBe('')
  expect(patches()).toHaveLength(1)
})

test('a normal save error still shows the SaveStatus alert', () => {
  render(<SaveStatus test={props({}, { saving: 'error' }).test} />)
  expect(screen.getByRole('alert').textContent).toBe(READINESS_COPY.saveError)
})

test.each(['draft', 'running'] as const)('real test page mounts in StrictMode (%s) with one fetch per resource and no errors', async status => {
  const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
  const fetcher = vi.fn(async (url: string) => response(url.endsWith('/click-keys') ? { keys: [] }
    : url.endsWith('/preflight') ? preflight()
    : url.includes('/xp-metrics') ? { docs: [], hasNextPage: false }
      : url.includes('/summary?') ? { [doc.id]: { exposures: 12 } }
        : { ...doc, status, updatedAt: '2026-11-03T10:00:00.000Z' }))
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<StrictMode><TestPage id={doc.id} surface={{ ...props().surface, canReadResults: true }} /></StrictMode>)
    await waitFor(() => expect(screen.getByText('Manage goals')).toBeTruthy())
    await act(async () => {})
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/xp-experiments/'))).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/preflight'))).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/xp-metrics'))).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/summary?'))).toHaveLength(status === 'running' ? 1 : 0)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(error).not.toHaveBeenCalled()
  } finally { error.mockRestore() }
})

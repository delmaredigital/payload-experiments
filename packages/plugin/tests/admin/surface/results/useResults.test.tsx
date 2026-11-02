// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useResults } from '../../../../src/admin/surface/results/useResults.js'
import { API_MESSAGES } from '../../../../src/admin/copy/common.js'
import { fixture, phaseFor } from '../../results/fixtures.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const options = { apiRoute: '/custom-api/', canReadResults: true }
const first = fixture('T7'), second = { ...fixture('T4'), phase: 2 }
const phases = [phaseFor(first), phaseFor(second)]
const doc = { status: 'running', arms: phases[1]!.arms }
const data = (round = 2) => ({ phases, snapshot: round === 1 ? first : second })
const deferred = () => {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function fetcher() {
  const fetch = vi.fn(async (url: string) => json(url.includes('/xp-experiments/') ? doc : data(url.includes('phase=1') ? 1 : 2)))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
test('loads the document and newest round with series only once when the default already matches', async () => {
  const fetch = fetcher()
  const { result } = renderHook(() => useResults('xp/one', options))
  await waitFor(() => expect(result.current.state).toBe('ready'))
  expect(result.current.round).toBe(2)
  expect(result.current.doc?.status).toBe('running')
  expect(result.current.data?.snapshot?.phase).toBe(2)
  expect(fetch.mock.calls.map(([url]) => url)).toContain('/custom-api/xp-experiments/xp%2Fone?depth=0')
  expect(fetch.mock.calls.map(([url]) => url)).toContain('/custom-api/xp/experiments/xp%2Fone/results?series=1')
  expect(fetch.mock.calls).toHaveLength(2)
  expect(fetch.mock.calls.filter(([url]) => url.includes('/results'))).toHaveLength(1)
})
test('decided tests default to the decision round rather than the rollout round', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.includes('/xp-experiments/') ? { ...doc, status: 'decided', decision: { phase: 1 } } : data(1))))
  const { result } = renderHook(() => useResults(1, options))
  await waitFor(() => expect(result.current.state).toBe('ready'))
  expect(result.current.round).toBe(1)
})
test('fetches the wanted default round when the first snapshot belongs to another round', async () => {
  const fetch = vi.fn(async (url: string) => json(url.includes('/xp-experiments/')
    ? { ...doc, status: 'decided', decision: { phase: 1 } } : data(url.includes('phase=1') ? 1 : 2)))
  vi.stubGlobal('fetch', fetch)
  const { result } = renderHook(() => useResults(1, options))
  await waitFor(() => expect(result.current.state).toBe('ready'))
  expect(result.current.round).toBe(1)
  expect(result.current.data?.snapshot?.phase).toBe(1)
  expect(fetch.mock.calls.filter(([url]) => url.includes('/results')).map(([url]) => url)).toEqual([
    '/custom-api/xp/experiments/1/results?series=1', '/custom-api/xp/experiments/1/results?phase=1&series=1',
  ])
})
test.each([
  [501, undefined, API_MESSAGES.notImplemented],
  [409, 'commit-unverified', API_MESSAGES.commitUnverified],
] as const)('results refusal %s uses the shared API message for code %s', async (status, code, message) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/xp-experiments/') ? json(doc)
    : json({ errors: [{ code, message: 'Raw server message' }] }, status)))
  const { result } = renderHook(() => useResults(1, options))
  await waitFor(() => expect(result.current.state).toBe('error'))
  expect(result.current.error).toBe(message)
})
test('round switching clears stale content, preserves options and ignores a late response', async () => {
  const fetch = fetcher()
  const { result } = renderHook(() => useResults(1, options))
  await waitFor(() => expect(result.current.state).toBe('ready'))
  const old = deferred()
  fetch.mockImplementation(async url => url.includes('phase=1') ? old.promise : json(url.includes('/xp-experiments/') ? doc : data()))
  act(() => result.current.setRound(1))
  expect(result.current.state).toBe('loading')
  expect(result.current.data).toBeUndefined()
  expect(result.current.phases).toHaveLength(2)
  act(() => result.current.setRound(2))
  await waitFor(() => expect(result.current.state).toBe('ready'))
  await act(async () => old.resolve(json(data(1))))
  expect(result.current.data?.snapshot?.phase).toBe(2)
})
test('reload after Recompute refetches the selected round and document', async () => {
  const fetch = fetcher()
  const { result } = renderHook(() => useResults(1, options))
  await waitFor(() => expect(result.current.state).toBe('ready'))
  act(() => result.current.setRound(1))
  await waitFor(() => expect(result.current.state).toBe('ready'))
  const before = fetch.mock.calls.length
  await act(async () => { await result.current.api.recompute(1); result.current.reload() })
  await waitFor(() => expect(result.current.state).toBe('ready'))
  expect(fetch.mock.calls.slice(before).map(([url]) => url)).toEqual([
    '/custom-api/xp/experiments/1/recompute', '/custom-api/xp-experiments/1?depth=0', '/custom-api/xp/experiments/1/results?phase=1&series=1',
  ])
})
test.each([[403, 'forbidden'], [404, 'missing'], [500, 'error']] as const)('handles %s from either read', async (status, state) => {
  for (const failedRead of ['document', 'results']) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.includes('/xp-experiments/') ? doc : data(),
      url.includes('/xp-experiments/') === (failedRead === 'document') ? status : 200)))
    const hook = renderHook(() => useResults(1, options))
    await waitFor(() => expect(hook.result.current.state).toBe(state))
    expect(hook.result.current.data).toBeUndefined()
    hook.unmount()
  }
})
test('handles empty, unreadable and network responses', async () => {
  for (const mode of ['empty', 'unreadable', 'network']) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/xp-experiments/')) return json(doc)
      if (mode === 'network') throw new Error('offline')
      return mode === 'empty' ? json({ phases: [], snapshot: null }) : new Response('not json')
    }))
    const hook = renderHook(() => useResults(1, options))
    await waitFor(() => expect(hook.result.current.state).toBe(mode === 'empty' ? 'empty' : 'error'))
    hook.unmount()
  }
})
test('denied readers make no reads and an id change never leaks previous content', async () => {
  const fetch = fetcher()
  const { result, rerender } = renderHook(({ id, canReadResults }) => useResults(id, { ...options, canReadResults }), { initialProps: { id: 'one', canReadResults: false } })
  expect(result.current.state).toBe('forbidden')
  expect(fetch).not.toHaveBeenCalled()
  rerender({ id: 'one', canReadResults: true })
  await waitFor(() => expect(result.current.state).toBe('ready'))
  fetch.mockImplementation(() => new Promise(() => {}))
  rerender({ id: 'two', canReadResults: true })
  expect(result.current.data).toBeUndefined()
  expect(result.current.doc).toBeUndefined()
})
test('unmount aborts the document read and ignores a late shared results response', async () => {
  const signals: AbortSignal[] = []
  const pending = deferred()
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    if (init.signal) signals.push(init.signal as AbortSignal)
    return url.includes('/xp-experiments/') ? Promise.resolve(json(doc)) : pending.promise
  }))
  const { result, unmount } = renderHook(() => useResults(1, options))
  expect(signals).toHaveLength(1)
  unmount()
  expect(signals.every(signal => signal.aborted)).toBe(true)
  await act(async () => pending.resolve(json(data())))
  expect(result.current.state).toBe('loading')
})

test('results-only readers never read the manager-only document and keep the server-selected decision round', async () => {
  const decision = fixture('T7')
  const rollout = { ...fixture('R3'), phase: 2 }
  const fetch = vi.fn(async (url: string) => url.includes('/xp-experiments/') ? json({}, 403)
    : json({ phases: [phaseFor(decision), phaseFor(rollout)], snapshot: decision, decisionSnapshot: decision, decision: { phase: 1, winnerArm: 'variantA' } }))
  vi.stubGlobal('fetch', fetch)
  const { result } = renderHook(() => useResults(1, { ...options, canManage: false }))
  await waitFor(() => expect(result.current.state).toBe('ready'))
  expect(result.current.round).toBe(1)
  expect(result.current.doc).toBeUndefined()
  expect(fetch.mock.calls.some(([url]) => url.includes('/xp-experiments/'))).toBe(false)
})

test('response decision takes precedence over a stale document decision when selecting the round', async () => {
  const old = fixture('T7'), newer = { ...old, phase: 2 }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.includes('/xp-experiments/')
    ? { ...doc, status: 'decided', decision: { phase: 1, winnerArm: 'control' } }
    : { phases: [phaseFor(old), phaseFor(newer)], snapshot: newer, decision: { phase: 2, winnerArm: 'variantA' } })))
  const { result } = renderHook(() => useResults(1, options))
  await waitFor(() => expect(result.current.state).toBe('ready'))
  expect(result.current.round).toBe(2)
})

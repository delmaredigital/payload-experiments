// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { XP_IF_UPDATED_AT_HEADER } from '../../../src/constants.js'
import { useTestDocument } from '../../../src/admin/surface/useTestDocument.js'
import type { TestDocument } from '../../../src/admin/surface/testDocument.model.js'
import type { PreflightResult } from '../../../src/types/endpoints.js'
import type { Status } from '../../../src/types/contracts.js'

const stateUpdates = vi.hoisted(() => vi.fn())
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useState: ((initial: unknown) => {
    const [value, setValue] = react.useState(initial)
    return [value, (next: unknown) => { stateUpdates(); setValue(next) }]
  }) as typeof react.useState }
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); stateUpdates.mockClear() })

const preflight: PreflightResult = { checks: [], placements: [], baseline: null, trafficPerDay: null, estimate: null }
const document = (partial: Partial<TestDocument> = {}): TestDocument => ({
  updatedAt: '2026-11-03T09:00:00.000Z', id: 'one/two', name: 'Original test', slug: 'test', status: 'draft', kind: 'flag', unitType: 'visitor',
  arms: [{ key: 'control', label: 'Original', weight: 50, kind: 'control' },
    { key: 'variantA', label: 'Variant A', weight: 50, kind: 'variant' }],
  allocation: 100, exposurePolicy: 'manual', hypothesis: 'Original hypothesis',
  analysis: { plannedDurationDays: 28, minExposuresPerArm: 200 }, ...partial,
})
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const url = '/cms-api/xp-experiments/one%2Ftwo?depth=0'
const preflightUrl = '/cms-api/xp/experiments/one%2Ftwo/preflight'

/** Wrap mock implementations too, so deferred reads really reject when their signal aborts. */
function stubFetch(handler: (input: string, init?: RequestInit) => Promise<Response>) {
  const fetcher = Object.assign(vi.fn(handler), { aborted: vi.fn() })
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal
    const abort = () => {
      const error = new DOMException('The operation was aborted.', 'AbortError')
      fetcher.aborted(error)
      reject(error)
    }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => fetcher(input, init)).then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', abort))
  }))
  return fetcher
}

function setup(doc = document(), patcher?: (patch: Partial<TestDocument>) => Promise<Response>) {
  let serverDoc = doc
  const fetcher = stubFetch(async (input: string, init?: RequestInit) => {
    if (input.endsWith('/preflight')) return response(preflight)
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(init.body as string) as Partial<TestDocument>
      if (patcher) return patcher(patch)
      serverDoc = { ...serverDoc, ...patch }
      return response({ doc: serverDoc, message: 'Updated successfully.' })
    }
    return response(serverDoc)
  })
  const hook = renderHook(() => useTestDocument(doc.id, { apiRoute: '/cms-api/' }))
  return { ...hook, fetcher, patches: () => fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH') }
}

test('loads the collection document then preflight with credentials and a configurable route', async () => {
  const { result, fetcher } = setup()
  expect(result.current.loadState).toBe('loading')
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  expect(result.current.doc).toEqual(document())
  expect(result.current.preflight).toEqual(preflight)
  expect(result.current.saving).toBe('idle')
  expect(fetcher.mock.calls.map(([input]) => input)).toEqual([url, preflightUrl])
  expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true)
})

test('staging is optimistic and sends nothing until commit; sends changed top-level keys only', async () => {
  const { result, patches, fetcher } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  act(() => {
    result.current.stage({ name: 'New' })
    result.current.stage({ name: 'New name', analysis: { ...result.current.doc?.analysis, plannedDurationDays: 35 } })
    result.current.stage({ hypothesis: 'Original hypothesis' })
  })
  expect(result.current.doc?.name).toBe('New name')
  expect(patches()).toHaveLength(0)
  await act(async () => { await result.current.commit() })
  expect(patches()).toHaveLength(1)
  const [input, init] = patches()[0]!
  expect(input).toBe(url)
  expect(init?.headers).toEqual({ 'Content-Type': 'application/json', [XP_IF_UPDATED_AT_HEADER]: '2026-11-03T09:00:00.000Z' })
  expect(JSON.parse(init?.body as string)).toEqual({ name: 'New name', analysis: { plannedDurationDays: 35, minExposuresPerArm: 200 } })
  expect(result.current.saving).toBe('saved')
  expect(fetcher.mock.calls.map(([input]) => input)).toEqual([url, preflightUrl, url, preflightUrl])
  await act(async () => { await result.current.commit() })
  expect(patches()).toHaveLength(1)
})

test('reverting a staged value makes commit a no-op', async () => {
  const { result, patches } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  await act(async () => {
    result.current.stage({ name: 'Temporary' })
    result.current.stage({ name: 'Original test' })
    await result.current.commit()
  })
  expect(patches()).toHaveLength(0)
  expect(result.current.saving).toBe('idle')
})

test('rapid commits never overlap and keep uncommitted later edits when the server responds', async () => {
  const first = deferred<Response>()
  const second = deferred<Response>()
  let count = 0
  const { result, patches } = setup(document(), () => ++count === 1 ? first.promise : second.promise)
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  let completed!: Promise<void>
  act(() => {
    result.current.stage({ name: 'First' })
    void result.current.commit()
    result.current.stage({ name: 'Second' })
    completed = result.current.commit()
    result.current.stage({ hypothesis: 'Still typing' })
  })
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(result.current.saving).toBe('saving')
  expect(result.current.doc?.name).toBe('Second')
  await act(async () => { first.resolve(response({ doc: document({ name: 'Server normalized first' }) })) })
  await waitFor(() => expect(patches()).toHaveLength(2))
  expect(JSON.parse(patches()[1]![1]?.body as string)).toEqual({ name: 'Second' })
  expect(result.current.doc?.name).toBe('Second')
  expect(result.current.doc?.hypothesis).toBe('Still typing')
  await act(async () => {
    second.resolve(response({ doc: document({ name: 'Second', allocation: 75 }) }))
    await completed
  })
  expect(result.current.doc).toMatchObject({ name: 'Second', allocation: 75, hypothesis: 'Still typing' })
  expect(patches()).toHaveLength(2)
})

test('serializes the next save after the preceding preflight refresh and uses its result', async () => {
  const refresh = deferred<Response>()
  const { result, fetcher, patches } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  fetcher.mockImplementationOnce(async () => response({ doc: document({ name: 'First' }) }))
    .mockImplementationOnce(() => refresh.promise)
  let completed!: Promise<void>
  act(() => {
    result.current.stage({ name: 'First' }); void result.current.commit()
    result.current.stage({ name: 'Second' }); completed = result.current.commit()
  })
  await waitFor(() => expect(fetcher.mock.calls.filter(([input]) => input === preflightUrl)).toHaveLength(2))
  expect(patches()).toHaveLength(1)
  await act(async () => { refresh.resolve(response({ ...preflight, trafficPerDay: 123 })); await completed })
  expect(patches()).toHaveLength(2)
  expect(result.current.preflight).toEqual(preflight)
})

test('refusal maps field errors and rolls back just the refused keys, preserving later edits', async () => {
  const refused = deferred<Response>()
  const { result, patches, fetcher } = setup(document(), () => refused.promise)
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  let completed!: Promise<void>
  act(() => {
    result.current.stage({ name: 'Refused', analysis: { plannedDurationDays: -1 } })
    completed = result.current.commit()
    result.current.stage({ hypothesis: 'Keep typing' })
  })
  await waitFor(() => expect(patches()).toHaveLength(1))
  await act(async () => {
    refused.resolve(response({ errors: [{ message: 'Invalid', data: { errors: [{ path: 'analysis.plannedDurationDays', message: 'Enter a positive number.' }] } }] }, 400))
    await completed
  })
  expect(result.current.doc).toMatchObject({ name: 'Original test', analysis: document().analysis, hypothesis: 'Keep typing' })
  expect(result.current.errors).toEqual({ 'analysis.plannedDurationDays': 'Enter a positive number.' })
  expect(result.current.saving).toBe('error')
  expect(fetcher.mock.calls.filter(([input]) => input === preflightUrl)).toHaveLength(1)
  act(() => result.current.stage({ analysis: { plannedDurationDays: 35 } }))
  expect(result.current.errors).toEqual({})
})

test.each(['section', 'field'])('a queued correction clears an earlier %s error when it succeeds', async kind => {
  const first = deferred<Response>()
  let count = 0
  const { result, patches } = setup(document(), async patch => ++count === 1 ? first.promise : response({ doc: document(patch) }))
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  let completed!: Promise<void>
  act(() => {
    result.current.stage({ name: '' }); void result.current.commit()
    result.current.stage({ name: 'Valid' }); completed = result.current.commit()
  })
  await waitFor(() => expect(patches()).toHaveLength(1))
  await act(async () => {
    first.resolve(response({ errors: [{ message: 'Name required', ...(kind === 'field'
      ? { data: { errors: [{ path: 'name', message: 'Name required' }] } } : {}) }] }, 400))
    await completed
  })
  expect(result.current.doc?.name).toBe('Valid')
  expect(result.current.saving).toBe('saved')
  expect(result.current.errors).toEqual({})
  expect(patches()).toHaveLength(2)
})

test.each<Status>(['running', 'decided', 'archived'])('locked and unknown keys are never staged or sent for %s', async status => {
  const { result, patches } = setup(document({ status }))
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  await act(async () => {
    result.current.stage({ allocation: 50, analysis: { plannedDurationDays: 35 }, arms: [], status: 'draft', slug: 'changed' } as Partial<TestDocument>)
    await result.current.commit()
  })
  expect(result.current.doc).toEqual(document({ status }))
  expect(patches()).toHaveLength(0)
})

test.each<Status>(['draft', 'stopped', 'running', 'decided', 'archived'])('first open defaults duration only for editable statuses: %s', async status => {
  const { result, patches, rerender } = setup(document({ status, analysis: { reachPerDay: 100 } }))
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  const editable = status === 'draft' || status === 'stopped'
  if (editable) await waitFor(() => expect(result.current.saving).toBe('saved'))
  rerender()
  expect(patches()).toHaveLength(editable ? 1 : 0)
  if (editable) {
    expect(JSON.parse(patches()[0]![1]?.body as string)).toEqual({ analysis: { reachPerDay: 100, plannedDurationDays: 28 } })
    expect(result.current.doc?.analysis?.plannedDurationDays).toBe(28)
  }
})

test('StrictMode does not persist the duration twice', async () => {
  const { fetcher, unmount } = setup(document({ analysis: null }))
  unmount()
  fetcher.mockClear()
  const { result } = renderHook(() => useTestDocument('one/two', { apiRoute: '/cms-api' }), { wrapper: StrictMode })
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  await act(async () => {})
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
})

test.each([[403, 'forbidden'], [404, 'missing'], [500, 'error']] as const)('collection %s maps to %s without preflight', async (status, state) => {
  const fetcher = stubFetch(async () => response({}, status))
  const { result } = renderHook(() => useTestDocument(1, { apiRoute: '/api' }))
  await waitFor(() => expect(result.current.loadState).toBe(state))
  expect(result.current.doc).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test.each([[403, 'forbidden'], [404, 'missing']] as const)('initial preflight %s hides the document; reload recovers', async (status, state) => {
  const { result, fetcher } = setup()
  fetcher.mockImplementationOnce(async () => response(document()))
    .mockImplementationOnce(async () => response({}, status))
  await waitFor(() => expect(result.current.loadState).toBe(state))
  expect(result.current.doc).toBeNull()
  expect(result.current.preflight).toBeNull()
  await act(async () => { await result.current.reload() })
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  expect(result.current.errors).toEqual({})
  expect(fetcher.mock.calls.map(([input]) => input)).toEqual([url, preflightUrl, url, preflightUrl])
})

test('reload waits for queued commits before fetching and accepts no edits during that wait', async () => {
  const first = deferred<Response>()
  let serverDoc = document()
  let count = 0
  const fetcher = stubFetch(async (input: string, init?: RequestInit) => {
    if (input.endsWith('/preflight')) return response(preflight)
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(init.body as string) as Partial<TestDocument>
      if (++count === 1) await first.promise
      serverDoc = { ...serverDoc, ...patch }
      return response({ doc: serverDoc })
    }
    return response(serverDoc)
  })
  const { result } = renderHook(() => useTestDocument('one/two', { apiRoute: '/cms-api' }))
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  let reloaded!: Promise<void>
  act(() => {
    result.current.stage({ name: 'First' }); void result.current.commit()
    result.current.stage({ hypothesis: 'Second' }); void result.current.commit()
    reloaded = result.current.reload()
    result.current.stage({ name: 'Ignored during reload' }); void result.current.commit()
  })
  await waitFor(() => expect(count).toBe(1))
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(2) // Initial doc and preflight only.
  await act(async () => { first.resolve(response({})); await reloaded })
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  expect(count).toBe(2)
  expect(result.current.doc).toMatchObject({ name: 'First', hypothesis: 'Second' })
  expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'GET', 'PATCH', 'GET', 'PATCH', 'GET', 'GET', 'GET'])
})

test('a refused automatic duration default is attempted only once across reloads', async () => {
  const { result, patches } = setup(document({ analysis: null }), async () => response({ errors: [{ message: 'Save refused' }] }, 400))
  await waitFor(() => expect(result.current.saving).toBe('error'))
  expect(patches()).toHaveLength(1)
  await act(async () => { await result.current.reload() })
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  expect(patches()).toHaveLength(1)
  expect(result.current.doc?.analysis).toBeNull()
})

test('changing document id ignores late responses from the old document', async () => {
  const old = deferred<Response>()
  const fetcher = stubFetch(async (input: string) => input.includes('old?') ? old.promise
    : response(input.endsWith('/preflight') ? preflight : document({ id: 'new', name: 'New document' })))
  const { result, rerender } = renderHook(({ id }) => useTestDocument(id, { apiRoute: '/api' }), { initialProps: { id: 'old' } })
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  rerender({ id: 'new' })
  await waitFor(() => expect(result.current.doc?.id).toBe('new'))
  await act(async () => { old.resolve(response(document({ id: 'old' }))) })
  expect(result.current.doc?.name).toBe('New document')
  expect(fetcher.mock.calls.some(([input]) => input.includes('/old/preflight'))).toBe(false)
  expect(fetcher.aborted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'AbortError' }))
})

test('network failure rolls back and leaves commit usable', async () => {
  let count = 0
  const { result } = setup(document(), async patch => {
    if (++count === 1) throw new TypeError('Failed to fetch')
    return response({ doc: document(patch) })
  })
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  await act(async () => { result.current.stage({ name: 'First' }); await result.current.commit() })
  expect(result.current.saving).toBe('error')
  expect(result.current.doc?.name).toBe('Original test')
  expect(result.current.errors._section).toContain("Couldn't reach the server")
  await act(async () => { result.current.stage({ name: 'Retry' }); await result.current.commit() })
  expect(result.current.doc?.name).toBe('Retry')
  expect(result.current.errors).toEqual({})
})

test.each([403, 404, 500, 'throw'] as const)('preflight refresh failure %s keeps the editor usable and clears on success', async failure => {
  const { result, fetcher } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  fetcher.mockImplementationOnce(async () => response({ doc: document({ name: 'Saved name' }) }))
    .mockImplementationOnce(async () => {
      if (failure === 'throw') throw new TypeError('Failed to fetch')
      return response({}, failure)
    })
  await act(async () => { result.current.stage({ name: 'Saved name' }); await result.current.commit() })
  expect(result.current.loadState).toBe('ready')
  expect(result.current.preflight).toEqual(preflight)
  expect(result.current.preflightError).toEqual(expect.any(String))
  expect(result.current.saving).toBe('saved')
  expect(result.current.errors).toEqual({})
  await act(async () => { result.current.stage({ hypothesis: 'Keep editing' }); await result.current.commit() })
  expect(result.current.doc?.hypothesis).toBe('Keep editing')
  expect(result.current.preflightError).toBeNull()
})

test('hasUnsaved covers staged, queued and in-flight changes until all PATCHes finish', async () => {
  const first = deferred<Response>()
  const second = deferred<Response>()
  let count = 0
  const { result, patches } = setup(document(), () => ++count === 1 ? first.promise : second.promise)
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  expect(result.current.hasUnsaved).toBe(false)
  act(() => result.current.stage({ name: 'First' }))
  expect(result.current.hasUnsaved).toBe(true)
  let completed!: Promise<void>
  act(() => {
    void result.current.commit()
    result.current.stage({ hypothesis: 'Second' }); completed = result.current.commit()
  })
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(result.current.hasUnsaved).toBe(true)
  expect(result.current.saving).toBe('saving')
  await act(async () => { first.resolve(response({ doc: document({ name: 'First' }) })) })
  await waitFor(() => expect(patches()).toHaveLength(2))
  expect(result.current.hasUnsaved).toBe(true)
  await act(async () => {
    second.resolve(response({ doc: document({ name: 'First', hypothesis: 'Second' }) })); await completed
  })
  expect(result.current.hasUnsaved).toBe(false)
})

test('unmount drains both submitted saves without aborting PATCHes or publishing state', async () => {
  const first = deferred<Response>()
  const second = deferred<Response>()
  let count = 0
  const { result, patches, fetcher, unmount } = setup(document(), () => ++count === 1 ? first.promise : second.promise)
  const warnings = vi.spyOn(console, 'error').mockImplementation(() => {})
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  let completed!: Promise<void>
  act(() => {
    result.current.stage({ name: 'First' }); void result.current.commit()
    result.current.stage({ hypothesis: 'Second' }); completed = result.current.commit()
  })
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(result.current.hasUnsaved).toBe(true)
  unmount()
  const updates = stateUpdates.mock.calls.length
  first.resolve(response({ doc: document({ name: 'First' }) }))
  await waitFor(() => expect(patches()).toHaveLength(2))
  expect(JSON.parse(patches()[1]![1]?.body as string)).toEqual({ hypothesis: 'Second' })
  expect(patches().every(([, init]) => init?.signal == null)).toBe(true)
  expect(stateUpdates).toHaveBeenCalledTimes(updates)
  second.resolve(response({ doc: document({ name: 'First', hypothesis: 'Second' }) }))
  await completed
  expect(stateUpdates).toHaveBeenCalledTimes(updates)
  expect(warnings).not.toHaveBeenCalled()
  expect(fetcher.aborted).not.toHaveBeenCalled()
  expect(fetcher.mock.calls.filter(([input]) => input === preflightUrl)).toHaveLength(1)
})

test('unmount aborts an outstanding document read with a real AbortError and no state publication', async () => {
  const read = deferred<Response>()
  const fetcher = stubFetch(() => read.promise)
  const { unmount } = renderHook(() => useTestDocument(1, { apiRoute: '/api' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  unmount()
  const updates = stateUpdates.mock.calls.length
  expect(fetcher.aborted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'AbortError' }))
  await act(async () => { read.resolve(response(document())) })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(stateUpdates).toHaveBeenCalledTimes(updates)
})

test('unmount releases a pending preflight read so the next PATCH can drain', async () => {
  const refresh = deferred<Response>()
  const { result, fetcher, patches, unmount } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  fetcher.mockImplementationOnce(async () => response({ doc: document({ name: 'First' }) }))
    .mockImplementationOnce(() => refresh.promise)
  let completed!: Promise<void>
  act(() => {
    result.current.stage({ name: 'First' }); void result.current.commit()
    result.current.stage({ hypothesis: 'Second' }); completed = result.current.commit()
  })
  await waitFor(() => expect(fetcher.mock.calls.filter(([input]) => input === preflightUrl)).toHaveLength(2))
  expect(patches()).toHaveLength(1)
  expect(result.current.hasUnsaved).toBe(true)
  unmount()
  const updates = stateUpdates.mock.calls.length
  await completed
  expect(patches()).toHaveLength(2)
  expect(fetcher.aborted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'AbortError' }))
  expect(JSON.parse(patches()[1]![1]?.body as string)).toEqual({ hypothesis: 'Second' })
  expect(stateUpdates).toHaveBeenCalledTimes(updates)
  await act(async () => { refresh.resolve(response(preflight)) })
  expect(stateUpdates).toHaveBeenCalledTimes(updates)
})

test('a synchronously throwing fetch cannot strand a queued commit or reject reload', async () => {
  const { result, fetcher, patches } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  fetcher.mockImplementationOnce(() => { throw new TypeError('Failed to fetch') })
  await act(async () => {
    result.current.stage({ name: 'Refused' }); void result.current.commit()
    result.current.stage({ hypothesis: 'Second' }); await result.current.commit()
  })
  expect(patches()).toHaveLength(2)
  expect(result.current.doc).toMatchObject({ name: 'Original test', hypothesis: 'Second' })
  expect(result.current.hasUnsaved).toBe(false)
  fetcher.mockImplementationOnce(() => { throw new TypeError('Failed to fetch') })
  await act(async () => { await expect(result.current.reload()).resolves.toBeUndefined() })
  await waitFor(() => expect(result.current.loadState).toBe('error'))
})

test('an unexpected throw before fetch cannot wedge the queue', async () => {
  const { result, patches } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  const analysis = { plannedDurationDays: 35, get reachPerDay(): number { throw new Error('Unexpected diff failure') } }
  await act(async () => {
    result.current.stage({ analysis }); void result.current.commit()
    result.current.stage({ name: 'Next save' }); await result.current.commit()
  })
  expect(patches()).toHaveLength(1)
  expect(result.current.doc?.name).toBe('Next save')
  expect(result.current.hasUnsaved).toBe(false)
  await act(async () => { await expect(result.current.reload()).resolves.toBeUndefined() })
})

test.each(['missing', 'invalid-json'] as const)('a 2xx PATCH with %s doc reloads instead of rolling back', async kind => {
  const recovery = deferred<Response>()
  const { result, fetcher } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  fetcher.mockImplementationOnce(async () => kind === 'missing' ? response({ message: 'Updated' })
    : { ...response(undefined), json: async () => { throw new SyntaxError('Invalid JSON') } } as Response)
    .mockImplementationOnce(() => recovery.promise)
    .mockImplementationOnce(async () => response({ ...preflight, trafficPerDay: 456 }))
  let completed!: Promise<void>
  act(() => {
    result.current.stage({ name: 'Applied' }); completed = result.current.commit()
    result.current.stage({ hypothesis: 'Still typing' })
  })
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(3))
  expect(result.current.doc?.name).toBe('Applied')
  expect(result.current.preflightPending).toBe(true)
  await act(async () => {
    recovery.resolve(response(document({ name: 'Applied and normalized' }))); await completed
  })
  expect(result.current.doc).toMatchObject({ name: 'Applied and normalized', hypothesis: 'Still typing' })
  expect(result.current.preflight?.trafficPerDay).toBe(456)
  expect(result.current.saving).toBe('saved')
  expect(result.current.errors).toEqual({})
  expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'GET', 'PATCH', 'GET', 'GET'])
})

test('stage clears only its field errors; section errors last until a successful commit', async () => {
  const { result } = setup(document(), async patch => patch.name === '' ? response({ errors: [{
    data: { errors: [{ message: 'Could not save this section.' }, { path: 'name', message: 'Enter a name.' },
      { path: 'analysis.plannedDurationDays', message: 'Enter a duration.' }] },
  }] }, 400) : response({ doc: document(patch) }))
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  await act(async () => { result.current.stage({ name: '' }); await result.current.commit() })
  act(() => result.current.stage({ hypothesis: 'Other section' }))
  expect(result.current.errors).toEqual({ _section: 'Could not save this section.', name: 'Enter a name.',
    'analysis.plannedDurationDays': 'Enter a duration.' })
  act(() => result.current.stage({ name: 'Valid' }))
  expect(result.current.errors).toEqual({ _section: 'Could not save this section.', 'analysis.plannedDurationDays': 'Enter a duration.' })
  await act(async () => { await result.current.commit() })
  expect(result.current.errors).toEqual({ 'analysis.plannedDurationDays': 'Enter a duration.' })
})

test('removing a stopped arm preserves the remaining row ids unchanged in the PATCH body', async () => {
  const original = document({ status: 'stopped' })
  const arms = [
    { ...original.arms[0]!, id: 'row-original', weight: 34 },
    { ...original.arms[1]!, id: 'row-variant-a', weight: 33 },
    { ...original.arms[1]!, key: 'variantB' as const, id: 'row-variant-b', weight: 33 },
  ]
  const { result, patches } = setup({ ...original, arms })
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  const remaining = [ { ...arms[0]!, weight: 50 }, { ...arms[2]!, weight: 50 } ]
  await act(async () => { result.current.stage({ arms: remaining }); await result.current.commit() })
  expect(JSON.parse(patches()[0]![1]?.body as string)).toEqual({ arms: remaining })
  expect(JSON.parse(patches()[0]![1]?.body as string).arms.map((arm: { id: string }) => arm.id))
    .toEqual(['row-original', 'row-variant-b'])
})

test.each([403, 404, 500, 'throw'] as const)('refreshPreflight only reads readiness and preserves loadState on %s', async failure => {
  const { result, fetcher, patches } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  act(() => result.current.stage({ hypothesis: 'Still typing' }))
  const before = result.current.doc
  const refresh = deferred<Response>()
  fetcher.mockImplementationOnce(async () => {
    const ready = await refresh.promise
    if (failure === 'throw') throw new TypeError('Failed to fetch')
    return ready
  })
  let completed!: Promise<void>
  act(() => { completed = result.current.refreshPreflight() })
  expect(result.current.preflightPending).toBe(true)
  expect(result.current.loadState).toBe('ready')
  await act(async () => { refresh.resolve(response({}, typeof failure === 'number' ? failure : 500)); await completed })
  expect(result.current.preflightPending).toBe(false)
  expect(result.current.loadState).toBe('ready')
  expect(result.current.doc).toEqual(before)
  expect(result.current.preflightError).toEqual(expect.any(String))
  expect(result.current.preflight).toEqual(preflight)
  expect(result.current.hasUnsaved).toBe(true)
  expect(result.current.errors).toEqual({})
  expect(patches()).toHaveLength(0)
  expect(fetcher.mock.calls.map(([input]) => input)).toEqual([url, preflightUrl, preflightUrl])
  fetcher.mockImplementationOnce(async () => response({ ...preflight, trafficPerDay: 321 }))
  await act(async () => { await result.current.refreshPreflight() })
  expect(result.current.preflight?.trafficPerDay).toBe(321)
  expect(result.current.preflightError).toBeNull()
  expect(result.current.loadState).toBe('ready')
  expect(result.current.preflightPending).toBe(false)
})
test('preflightPending spans a successful save through its deferred preflight refresh', async () => {
  const saved = deferred<Response>()
  const refresh = deferred<Response>()
  const { result, fetcher } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  expect(result.current.preflightPending).toBe(false)
  fetcher.mockImplementationOnce(() => saved.promise).mockImplementationOnce(() => refresh.promise)
  let completed!: Promise<void>
  act(() => { result.current.stage({ name: 'Saved' }); completed = result.current.commit() })
  expect(result.current.preflightPending).toBe(false)
  await act(async () => { saved.resolve(response({ doc: document({ name: 'Saved' }) })) })
  expect(result.current.saving).toBe('saved')
  expect(result.current.hasUnsaved).toBe(false)
  expect(result.current.preflightPending).toBe(true)
  await act(async () => { refresh.resolve(response({ ...preflight, trafficPerDay: 123 })); await completed })
  expect(result.current.preflightPending).toBe(false)
  expect(result.current.preflight?.trafficPerDay).toBe(123)
})
test('overlapping preflight refreshes remain pending until all settle and ignore stale responses', async () => {
  const { result, fetcher } = setup()
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  const first = deferred<Response>(); const second = deferred<Response>()
  fetcher.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  let one!: Promise<void>; let two!: Promise<void>
  act(() => { one = result.current.refreshPreflight(); two = result.current.refreshPreflight() })
  expect(result.current.preflightPending).toBe(true)
  await act(async () => { second.resolve(response({ ...preflight, trafficPerDay: 200 })); await two })
  expect(result.current.preflightPending).toBe(true)
  expect(result.current.preflight?.trafficPerDay).toBe(200)
  await act(async () => { first.resolve(response({}, 403)); await one })
  expect(result.current.preflightPending).toBe(false)
  expect(result.current.preflightError).toBeNull()
  expect(result.current.preflight?.trafficPerDay).toBe(200)
})
test.each([1, 'uuid-goal'])('unchanged typed relationship ids (%s) never send an extra PATCH', async id => {
  const { result, patches } = setup(document({ metrics: { primary: id, guardrails: [id], secondary: [] } }))
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  await act(async () => {
    result.current.stage({ metrics: { primary: id, guardrails: [id], secondary: [] } })
    await result.current.commit()
  })
  expect(patches()).toHaveLength(0)
})


test('each queued PATCH sends its current saved baseline, including the preceding PATCH timestamp', async () => {
  const first = deferred<Response>()
  const loadedAt = '2026-11-03T10:00:00.000Z'
  const savedAt = '2026-11-03T10:01:00.000Z'
  let count = 0
  const { result, patches } = setup(document({ updatedAt: loadedAt }), async patch =>
    ++count === 1 ? first.promise : response({ doc: document({ ...patch, updatedAt: savedAt }) }))
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  let completed!: Promise<void>
  act(() => {
    result.current.stage({ name: 'First' }); void result.current.commit()
    result.current.stage({ hypothesis: 'Second' }); completed = result.current.commit()
  })
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(new Headers(patches()[0]![1]?.headers).get(XP_IF_UPDATED_AT_HEADER)).toBe(loadedAt)
  await act(async () => {
    first.resolve(response({ doc: document({ name: 'First', updatedAt: savedAt }) }))
    await completed
  })
  expect(patches()).toHaveLength(2)
  expect(new Headers(patches()[1]![1]?.headers).get(XP_IF_UPDATED_AT_HEADER)).toBe(savedAt)
})

test('a missing timestamp must be restored by a GET before PATCH; an unreadable GET blocks the save', async () => {
  const { result, patches, fetcher } = setup(document({ updatedAt: undefined }))
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  await act(async () => { result.current.stage({ name: 'New' }); await result.current.commit() })
  expect(patches()).toHaveLength(0)
  expect(fetcher.mock.calls.filter(([input]) => input === url)).toHaveLength(2)
  expect(result.current.saving).toBe('error')
})

test.each([undefined, 'A newer edit was saved. Reload this test.'])('stale-edit freezes typed values and drops queued saves until Reload (message %s)', async message => {
  const refused = deferred<Response>()
  const { result, patches, fetcher } = setup(document({ updatedAt: '2026-11-03T10:00:00.000Z' }), () => refused.promise)
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  let completed!: Promise<void>
  act(() => {
    result.current.stage({ name: 'Refused name' }); void result.current.commit()
    result.current.stage({ hypothesis: 'Queued hypothesis' }); completed = result.current.commit()
    result.current.stage({ allocation: 80 })
  })
  await waitFor(() => expect(patches()).toHaveLength(1))
  await act(async () => {
    refused.resolve(response({ errors: [{ code: 'stale-edit', message }] }, 409))
    await completed
  })
  expect(result.current.stale).toBe(true)
  expect(result.current.saving).toBe('error')
  expect(result.current.errors).toEqual({ _section: message ?? 'Someone else changed this test. Reload to see their changes.' })
  expect(result.current.doc).toMatchObject({ name: 'Refused name', hypothesis: 'Queued hypothesis', allocation: 80 })
  await act(async () => { result.current.stage({ name: 'Must not save' }); await result.current.commit() })
  expect(patches()).toHaveLength(1)
  expect(result.current.doc?.name).toBe('Refused name')
  fetcher.mockImplementationOnce(async () => response(document({ name: 'Someone else saved', updatedAt: '2026-11-03T10:02:00.000Z' })))
  await act(async () => { await result.current.reload() })
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  expect(result.current.stale).toBe(false)
  expect(result.current.hasUnsaved).toBe(false)
  expect(result.current.errors).toEqual({})
  expect(result.current.doc).toMatchObject({ name: 'Someone else saved', hypothesis: 'Original hypothesis', allocation: 100 })
  expect(patches()).toHaveLength(1)
  fetcher.mockImplementationOnce(async () => response({ doc: document({ name: 'Fresh edit', updatedAt: '2026-11-03T10:03:00.000Z' }) }))
  await act(async () => { result.current.stage({ name: 'Fresh edit' }); await result.current.commit() })
  expect(patches()).toHaveLength(2)
  expect(new Headers(patches()[1]![1]?.headers).get(XP_IF_UPDATED_AT_HEADER)).toBe('2026-11-03T10:02:00.000Z')
})

test.each(['aborted', 'failed'] as const)('unreadable success re-reads before the queued PATCH when recovery is %s', async recovery => {
  const first = deferred<Response>()
  const loadedAt = '2026-11-03T10:00:00.000Z'
  let serverDoc = document({ updatedAt: loadedAt })
  let count = 0
  let reads = 0
  const fetcher = stubFetch(async (input, init) => {
    if (input.endsWith('/preflight')) return response(preflight)
    if (init?.method === 'PATCH') {
      count++
      if (count === 1) {
        serverDoc = { ...serverDoc, name: 'First', updatedAt: '2026-11-03T10:01:00.000Z' }
        return first.promise
      }
      // Model the real server refusal if the old, now-stale timestamp is sent.
      const baseline = new Headers(init.headers).get(XP_IF_UPDATED_AT_HEADER)
      if (baseline && baseline !== serverDoc.updatedAt) return response({ errors: [{ code: 'stale-edit' }] }, 409)
      serverDoc = { ...serverDoc, ...JSON.parse(init.body as string), updatedAt: '2026-11-03T10:02:00.000Z' }
      return response({ doc: serverDoc })
    }
    if (++reads === 2 && recovery === 'failed') throw new Error('Read failed')
    return response(serverDoc)
  })
  const { result, unmount } = renderHook(() => useTestDocument(serverDoc.id, { apiRoute: '/cms-api' }))
  await waitFor(() => expect(result.current.loadState).toBe('ready'))
  let completed!: Promise<void>
  act(() => {
    result.current.stage({ name: 'First' }); void result.current.commit()
    result.current.stage({ hypothesis: 'Second' }); completed = result.current.commit()
  })
  await waitFor(() => expect(count).toBe(1))
  if (recovery === 'aborted') unmount()
  await act(async () => {
    first.resolve({ ok: true, status: 200, json: async () => { throw new Error('Lost body') } } as unknown as Response)
    await completed
  })
  const patches = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')
  expect(patches).toHaveLength(2)
  expect(new Headers(patches[1]![1]?.headers).get(XP_IF_UPDATED_AT_HEADER)).toBe('2026-11-03T10:01:00.000Z')
  expect(serverDoc.hypothesis).toBe('Second')
  expect(reads).toBe(recovery === 'aborted' ? 2 : 3)
  if (recovery === 'failed') {
    expect(result.current.stale).toBe(false)
    expect(result.current.saving).toBe('saved')
    await act(async () => { result.current.stage({ allocation: 90 }); await result.current.commit() })
    const last = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH').at(-1)!
    expect(new Headers(last[1]?.headers).get(XP_IF_UPDATED_AT_HEADER)).toBe('2026-11-03T10:02:00.000Z')
  }
})

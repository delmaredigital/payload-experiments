// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useTestDocument } from '../../../../src/admin/surface/useTestDocument.js'
import type { TestDocument } from '../../../../src/admin/surface/testDocument.model.js'
import { VersionsSection } from '../../../../src/admin/surface/test/VersionsSection.js'
import { pageBlockParts } from '../../../../src/admin/surface/pageBlock/parts.js'
import { checkArms } from '../../../../src/collections/experiments/armInvariants.js'
import type { SurfaceProps } from '../../../../src/admin/surface/contracts.js'
import { defaultArms } from '../../../../src/admin/arms/arms.model.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const response = (value: unknown, status = 200) => ({ ok: status === 200, status, json: async () => value }) as Response
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const document = (id = 'drain'): TestDocument => ({ id, name: 'Before', slug: id, kind: 'block', status: 'draft', unitType: 'visitor', arms: defaultArms('block'), allocation: 100, exposurePolicy: 'render', analysis: { plannedDurationDays: 28 } })
const preflight = { checks: [], placements: [], baseline: null, trafficPerDay: null, estimate: null }

test('reopening waits for every submitted save before reading the document', async () => {
  const first = deferred(); const second = deferred()
  let server = document(); let count = 0
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/preflight')) return response(preflight)
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(init.body as string) as Partial<TestDocument>
      await (++count === 1 ? first.promise : second.promise)
      server = { ...server, ...patch }
      return response({ doc: server })
    }
    return response(server)
  })
  vi.stubGlobal('fetch', fetcher)
  const original = renderHook(() => useTestDocument('drain', { apiRoute: '/api' }))
  await waitFor(() => expect(original.result.current.loadState).toBe('ready'))
  act(() => {
    original.result.current.stage({ name: 'After' }); void original.result.current.commit()
    original.result.current.stage({ hypothesis: 'Also saved' }); void original.result.current.commit()
  })
  await waitFor(() => expect(count).toBe(1))
  original.unmount()
  const readsBefore = fetcher.mock.calls.filter(([, init]) => init?.method === 'GET').length
  const reopened = renderHook(() => useTestDocument('drain', { apiRoute: '/api/' }))
  await act(async () => { await Promise.resolve() })
  expect(reopened.result.current.loadState).toBe('loading')
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(readsBefore)
  await act(async () => { first.resolve() })
  await waitFor(() => expect(count).toBe(2))
  expect(reopened.result.current.doc).toBeNull()
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(readsBefore)
  await act(async () => { second.resolve() })
  await waitFor(() => expect(reopened.result.current.loadState).toBe('ready'))
  expect(reopened.result.current.doc).toMatchObject({ name: 'After', hypothesis: 'Also saved' })
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH').every(([, init]) => !init?.signal)).toBe(true)
})
test('draining waits are isolated by API route and document id, and refused saves release the read', async () => {
  const save = deferred()
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/preflight')) return response(preflight)
    if (init?.method === 'PATCH') { await save.promise; return response({ errors: [{ message: 'Refused' }] }, 400) }
    return response(document())
  })
  vi.stubGlobal('fetch', fetcher)
  const old = renderHook(() => useTestDocument('drain', { apiRoute: '/api' }))
  await waitFor(() => expect(old.result.current.loadState).toBe('ready'))
  act(() => { old.result.current.stage({ name: 'Refused' }); void old.result.current.commit() })
  old.unmount()
  const same = renderHook(() => useTestDocument('drain', { apiRoute: '/api' }))
  const otherRoute = renderHook(() => useTestDocument('drain', { apiRoute: '/other' }))
  const otherId = renderHook(() => useTestDocument('different', { apiRoute: '/api' }))
  await waitFor(() => expect(otherRoute.result.current.loadState).toBe('ready'))
  await waitFor(() => expect(otherId.result.current.loadState).toBe('ready'))
  expect(same.result.current.loadState).toBe('loading')
  await act(async () => { save.resolve() })
  await waitFor(() => expect(same.result.current.loadState).toBe('ready'))
  expect(same.result.current.doc?.name).toBe('Before')
})
test('an unmounted reopening never starts a stale read when the drain completes', async () => {
  const save = deferred()
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/preflight')) return response(preflight)
    if (init?.method === 'PATCH') { await save.promise; return response({ doc: document('cancelled') }) }
    return response(document('cancelled'))
  })
  vi.stubGlobal('fetch', fetcher)
  const old = renderHook(() => useTestDocument('cancelled', { apiRoute: '/api' }))
  await waitFor(() => expect(old.result.current.loadState).toBe('ready'))
  let completed!: Promise<void>
  act(() => { old.result.current.stage({ name: 'New' }); completed = old.result.current.commit() })
  old.unmount()
  const reopened = renderHook(() => useTestDocument('cancelled', { apiRoute: '/api' }))
  reopened.unmount()
  await act(async () => { save.resolve(); await completed })
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(2)
})

test('custom share blur saves a valid whole group through the real document queue', async () => {
  let server = document('weights')
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/preflight')) return response(preflight)
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(init.body as string) as Partial<TestDocument>
      expect(checkArms(patch.arms!, 'block')).toEqual([])
      server = { ...server, ...patch }
      return response({ doc: server })
    }
    return response(server)
  })
  vi.stubGlobal('fetch', fetcher)
  const surface: SurfaceProps = { apiRoute: '/api', adminRoute: '/admin', canManage: true, canReadResults: true,
    isAdmin: false, flagPoints: [], attributeKeys: {}, metricSources: [] }
  function Editor() {
    const test = useTestDocument('weights', { apiRoute: '/api' })
    return test.doc ? <VersionsSection test={test} surface={surface} parts={pageBlockParts} /> : null
  }
  render(<Editor />)
  await waitFor(() => expect(screen.getByLabelText('Original: Share (%)')).toBeTruthy())
  const input = screen.getByLabelText('Original: Share (%)')
  fireEvent.change(input, { target: { value: '40' } })
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  fireEvent.blur(input)
  await waitFor(() => expect((screen.getByLabelText('Variant A: Share (%)') as HTMLInputElement).value).toBe('60'))
  await waitFor(() => expect(server.arms.map(arm => arm.weight)).toEqual([40, 60]))
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
})

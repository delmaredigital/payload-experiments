// @vitest-environment jsdom
import { REST_GET, REST_PATCH } from '@payloadcms/next/routes'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { useTestDocument } from '../src/admin/surface/useTestDocument.js'
import { TEST_PAGE } from '../src/admin/copy/testPage.js'
import type { TestDocument } from '../src/admin/surface/testDocument.model.js'
import { createIntegrationHarness } from './harness.js'

// jsdom installs its own-realm Uint8Array/ArrayBuffer globals, while Node's TextEncoder and Buffer
// return Node-realm bytes, so jose's `instanceof Uint8Array` checks (Payload login and JWT verify)
// fail. The hook needs jsdom; Payload's server code needs Node's typed arrays. Restore Node's for
// this file only, and put jsdom's back afterwards.
const jsdomTypedArrays = { Uint8Array: globalThis.Uint8Array, ArrayBuffer: globalThis.ArrayBuffer }
globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor as Uint8ArrayConstructor
globalThis.ArrayBuffer = Buffer.from('x').buffer.constructor as ArrayBufferConstructor

// Train-only: no database fallback, and no mocked hook, REST response or lock.
describe.skipIf(!process.env.INTEGRATION_DATABASE_URL)('admin stale-edit REST round trip', () => {
  let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
  let restoreCache: (() => void) | undefined
  type Manager = 'A' | 'B'
  const emails = { A: 'stale-client-a@example.test', B: 'stale-client-b@example.test' }
  const tokens = new Map<Manager, string>()
  let activeManager: Manager = 'A'
  type Exchange = {
    manager: Manager; url: string; method: string; credentials: RequestCredentials
    baseline: string | null; contentType: string | null; body: unknown
    status: number; response: { doc?: TestDocument; errors?: Array<{ code: string; message: string }> }
  }
  const exchanges: Exchange[] = []

  beforeAll(async () => {
    harness = await createIntegrationHarness({ manage: ({ req }) => Object.values(emails).includes(req.user?.email ?? '') })
    // The harness deliberately boots BasePayload directly. Register that exact
    // instance in Payload 3.90.2's native getPayload cache (dist/index.js:532-557),
    // so the public Next handlers do not boot a second adapter against its schema.
    // Restore the entry after this file; routing and authentication stay real.
    const cache = (globalThis as typeof globalThis & {
      _payload: Map<string, { payload: typeof harness.payload; initializedCrons: boolean; promise: null; reload: boolean; ws: null }>
    })._payload
    const previous = cache.get('default')
    cache.set('default', { payload: harness.payload, initializedCrons: true, promise: null, reload: false, ws: null })
    restoreCache = () => { if (previous) cache.set('default', previous); else cache.delete('default') }
    expect(await getPayload({ config: harness.payload.config })).toBe(harness.payload)

    for (const manager of ['A', 'B'] as const) {
      await harness.payload.create({ collection: 'users', overrideAccess: true,
        data: { email: emails[manager], password: 'integration-only-password' } })
      const login = await harness.payload.login({ collection: 'users', data: { email: emails[manager], password: 'integration-only-password' } })
      if (!login.token) throw new Error('Integration manager login returned no token')
      tokens.set(manager, login.token)
    }

    const handlers = { GET: REST_GET(harness.payload.config), PATCH: REST_PATCH(harness.payload.config) }
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const manager = activeManager
      // Resolve browser-relative URLs and emulate only the browser's auth jar.
      // All hook-supplied options, including credentials, headers and JSON, pass
      // through to the real handler. Never synthesize a stale-edit response.
      const request = new Request(typeof input === 'string' ? new URL(input, 'http://localhost') : input, init)
      request.headers.set('Authorization', `JWT ${tokens.get(manager)!}`)
      const url = new URL(request.url)
      const method = request.method
      if (method !== 'GET' && method !== 'PATCH') throw new Error('Unexpected admin request method')
      const body: unknown = method === 'PATCH' ? await request.clone().json() : undefined
      // Public Next entry, usable without a Next server/request context:
      // @payloadcms/next/dist/routes/rest/index.js:5-24 (PATCH export:31).
      const response = await handlers[method](request, {
        params: Promise.resolve({ slug: url.pathname.slice('/api/'.length).split('/').map(decodeURIComponent) }),
      })
      exchanges.push({ manager, url: `${url.pathname}${url.search}`, method, credentials: request.credentials,
        baseline: request.headers.get('x-xp-if-updated-at'), contentType: request.headers.get('Content-Type'), body,
        status: response.status, response: await response.clone().json() as Exchange['response'] })
      return response
    })
  }, 60_000)

  afterAll(async () => {
    cleanup()
    vi.unstubAllGlobals()
    restoreCache?.()
    await harness?.teardown()
    globalThis.Uint8Array = jsdomTypedArrays.Uint8Array
    globalThis.ArrayBuffer = jsdomTypedArrays.ArrayBuffer
  })

  test('two managers conflict, Reload recovers, and one manager can save twice with returned timestamps', async () => {
    const doc = await harness.payload.create({ collection: 'xp-experiments', overrideAccess: true, data: {
      name: 'Admin stale edit', slug: 'admin-stale-edit', kind: 'block', unitType: 'visitor',
      exposurePolicy: 'render', allocation: 100, analysis: { plannedDurationDays: 28 },
      arms: [
        { key: 'control', kind: 'control', label: 'Original', slot: 'control', weight: 50 },
        { key: 'variantA', kind: 'variant', label: 'Variant A', slot: 'variantA', weight: 50 },
      ],
    } })
    // Payload timestamps have millisecond precision; make sure A's save advances past the fixture's.
    while (Date.now() <= new Date(doc.updatedAt).getTime()) await new Promise(resolve => setTimeout(resolve, 1))
    const documentUrl = `/api/xp-experiments/${encodeURIComponent(String(doc.id))}?depth=0`
    const patches = () => exchanges.filter(exchange => exchange.method === 'PATCH')
    const open = async (manager: Manager) => {
      activeManager = manager
      const hook = renderHook(() => useTestDocument(doc.id, { apiRoute: '/api' }))
      await waitFor(() => expect(hook.result.current.loadState).toBe('ready'), { timeout: 10_000 })
      return hook
    }
    const a = await open('A')
    const b = await open('B')
    const baseline = a.result.current.doc!.updatedAt
    // Recorded in the router and asserted here, so a failure is not swallowed by the hook's catch.
    expect(exchanges.every(exchange => exchange.credentials === 'include')).toBe(true)
    expect(b.result.current.doc!.updatedAt).toBe(baseline)
    expect(baseline).toMatch(/\.\d{3}Z$/)
    expect(patches()).toHaveLength(0) // No automatic default save can hide the shared baseline.

    const save = async (manager: Manager, hook: typeof a, name: string) => {
      activeManager = manager
      act(() => { hook.result.current.stage({ name }) })
      await act(async () => { await hook.result.current.commit() })
    }
    await save('A', a, 'Manager A saved')
    expect(a.result.current.saving).toBe('saved')
    const first = patches()[0]!
    expect(first).toMatchObject({ manager: 'A', url: documentUrl, method: 'PATCH', credentials: 'include',
      baseline, contentType: 'application/json', body: { name: 'Manager A saved' }, status: 200 })
    expect(first.response.doc?.name).toBe('Manager A saved')
    expect(first.response.doc?.updatedAt).not.toBe(baseline)

    // (a) B's real stale request reaches the lock and its serialized refusal
    // drives the real hook's stale branch, preserving the typed name.
    await save('B', b, 'Manager B typed')
    const refused = patches()[1]!
    expect(refused).toMatchObject({ manager: 'B', url: documentUrl, credentials: 'include', baseline,
      body: { name: 'Manager B typed' }, status: 409,
      response: { errors: [{ code: 'stale-edit', message: 'Someone else changed this test. Reload to see their changes.' }] } })
    expect(b.result.current).toMatchObject({ stale: true, saving: 'error', hasUnsaved: true,
      errors: { _section: TEST_PAGE.staleEdit }, doc: { name: 'Manager B typed' } })
    const requestsAtRefusal = exchanges.length
    act(() => { b.result.current.stage({ hypothesis: 'Blocked while stale' }) })
    await act(async () => { await b.result.current.commit(); await b.result.current.commit() })
    expect(exchanges).toHaveLength(requestsAtRefusal)
    expect(b.result.current.doc?.name).toBe('Manager B typed')
    expect((await harness.payload.findByID({ collection: 'xp-experiments', id: doc.id, overrideAccess: true })).name).toBe('Manager A saved')

    // (b) Reload uses the winner's timestamp, then B can edit and save again.
    await act(async () => { await b.result.current.reload() })
    await waitFor(() => expect(b.result.current).toMatchObject({ loadState: 'ready', stale: false,
      hasUnsaved: false, doc: { name: 'Manager A saved', updatedAt: first.response.doc!.updatedAt } }), { timeout: 10_000 })
    await save('B', b, 'Manager B after Reload')
    expect(b.result.current.saving).toBe('saved')
    expect(patches()[2]).toMatchObject({ manager: 'B', status: 200, baseline: first.response.doc!.updatedAt,
      body: { name: 'Manager B after Reload' } })

    // (c) A second sequential save uses precisely the first returned timestamp,
    // including milliseconds, with no recovery GET replacing that baseline.
    const returned = patches()[2]!.response.doc!.updatedAt
    expect(returned).toMatch(/\.\d{3}Z$/)
    expect(b.result.current.doc?.updatedAt).toBe(returned)
    const beforeSecondSave = exchanges.length
    await save('B', b, 'Manager B next save')
    expect(b.result.current).toMatchObject({ saving: 'saved', stale: false, hasUnsaved: false,
      doc: { name: 'Manager B next save' } })
    expect(patches()).toHaveLength(4)
    expect(patches()[3]).toMatchObject({ manager: 'B', status: 200, url: documentUrl, baseline: returned,
      body: { name: 'Manager B next save' } })
    expect(exchanges[beforeSecondSave]!.method).toBe('PATCH')
    expect((await harness.payload.findByID({ collection: 'xp-experiments', id: doc.id, overrideAccess: true })).name).toBe('Manager B next save')
  })
})

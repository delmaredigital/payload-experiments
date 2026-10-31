import { createHmac } from 'node:crypto'
import type { PayloadRequest } from 'payload'
import { describe, expect, test, vi } from 'vitest'
import { buildEndpoints, ROUTES } from '../../src/endpoints/index.js'
import { defineExperimentsProxyRuntime } from '../../src/runtime/proxyRuntime.js'
import { defineExperimentsServerRuntime } from '../../src/server/serverRuntime.js'
import type { ExperimentsPluginOptions, ExperimentsAccess } from '../../src/types/contracts.js'

const paths = [
  ['get', '/xp/manifest'], ['post', '/xp/events'],
  ...['start', 'allocate', 'add-metric', 'stop', 'decide', 'release-holdout', 'make-content', 'archive'].map(action => ['post', `/xp/experiments/:id/${action}`]),
  ['get', '/xp/experiments/:id/preflight'], ['get', '/xp/experiments/:id/preview-token'],
  ['get', '/xp/experiments/:id/results'], ['post', '/xp/experiments/:id/recompute'], ['get', '/xp/experiments/summary'],
]
function options(value: unknown = true, readResults?: ExperimentsAccess): ExperimentsPluginOptions {
  return {
    runtime: defineExperimentsServerRuntime(defineExperimentsProxyRuntime({ secret: ['first-key', 'previous-key'], apiRoute: '/api' }), { getPayload: vi.fn() }),
    access: { manage: vi.fn(async () => value) as ExperimentsAccess, readResults },
  }
}
function request(user = true, headers: Record<string, string> = {}): PayloadRequest {
  return { user: user ? { id: 1 } : null, headers: new Headers(headers) } as PayloadRequest
}
async function invoke(path: string, opts: ExperimentsPluginOptions, req: PayloadRequest): Promise<Response> {
  const endpoint = buildEndpoints({ options: opts }).find(route => route.path === path)!
  return await endpoint.handler(req)
}
async function assertResponse(response: Response, status: number, code: string) {
  expect(response.status).toBe(status)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(await response.json()).toEqual({ errors: [{ code, message: expect.any(String) }] })
}
test('each frozen route is registered once, with the expected access kind', () => {
  expect(ROUTES.map(({ method, path }) => [method, path])).toEqual(paths)
  expect(new Set(ROUTES.map(({ method, path }) => `${method}:${path}`)).size).toBe(15)
  expect(ROUTES.map(route => route.access)).toEqual(['manifestKey', 'signedCookie', ...Array(10).fill('manage'), 'readResults', 'manage', 'readResults'])
  expect(buildEndpoints({ options: options() }).map(({ method, path }) => [method, path])).toEqual(paths)
})
for (const route of ROUTES.filter(route => route.access === 'manage' || route.access === 'readResults')) {
  describe(route.path, () => {
    test('no user is 401 before invoking access', async () => {
      const opts = options()
      await assertResponse(await invoke(route.path, opts, request(false)), 401, 'unauthenticated')
      expect(opts.access.manage).not.toHaveBeenCalled()
    })
    test.each([false, 'yes', {}])('only literal true grants access (%j)', async value => {
      await assertResponse(await invoke(route.path, options(value), request()), 403, 'forbidden')
    })
    test('true reaches the 501 handler', async () => {
      await assertResponse(await invoke(route.path, options(), request()), 501, 'not-implemented')
    })
    if (route.access === 'readResults') {
      test('explicit readResults overrides manage, also requiring literal true', async () => {
        const req = request()
        const allowed = options(false, vi.fn(async () => true))
        await assertResponse(await invoke(route.path, allowed, req), 501, 'not-implemented')
        expect(allowed.access.readResults).toHaveBeenCalledWith({ req })
        expect(allowed.access.manage).not.toHaveBeenCalled()
        for (const value of [false, 'yes', {}]) {
          await assertResponse(await invoke(route.path, options(true, vi.fn(async () => value) as unknown as ExperimentsAccess), req), 403, 'forbidden')
        }
      })
    }
  })
}
test('manifest key is private and uses the first signing secret', async () => {
  for (const header of [undefined, 'wrong', 'a'.repeat(64), 'é'.repeat(32), createHmac('sha256', 'previous-key').update('xp:manifest-key').digest('hex')]) {
    await assertResponse(await invoke('/xp/manifest', options(), request(false, header ? { 'x-xp-manifest-key': header } : {})), 401, 'unauthenticated')
  }
  const key = createHmac('sha256', 'first-key').update('xp:manifest-key').digest('hex')
  await assertResponse(await invoke('/xp/manifest', options(), request(false, { 'x-xp-manifest-key': key })), 501, 'not-implemented')
})
test('signed cookie stub is mapped to CORE-04 501', async () => {
  const cookieHeaders: Array<Record<string, string>> = [{}, { cookie: 'xp_id=unsigned' }]
  for (const headers of cookieHeaders) {
    const response = await invoke('/xp/events', options(), request(false, headers))
    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({ errors: [{ code: 'not-implemented', message: 'CORE-04' }] })
  }
})

test('transition stubs identify their owning lanes', async () => {
  const lanes = { start: 'CORE-10b', allocate: 'CORE-10b', 'add-metric': 'CORE-10b', stop: 'CORE-10b', decide: 'CORE-11', 'release-holdout': 'CORE-11', 'make-content': 'CORE-12', archive: 'CORE-11' }
  for (const [action, lane] of Object.entries(lanes)) {
    const response = await invoke(`/xp/experiments/:id/${action}`, options(), request())
    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({ errors: [{ code: 'not-implemented', message: lane }] })
  }
})

import { createHmac } from 'node:crypto'
import type { PayloadRequest } from 'payload'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as unitCookie from '../../src/runtime/cookie.js'
import { XpNotImplemented, XpRefusal } from '../../src/errors.js'
import { buildEndpoints, ROUTES } from '../../src/endpoints/index.js'
import { defineExperimentsProxyRuntime } from '../../src/runtime/proxyRuntime.js'
import { defineExperimentsServerRuntime } from '../../src/server/serverRuntime.js'
import type { ExperimentsPluginOptions, ExperimentsAccess } from '../../src/types/contracts.js'

afterEach(() => vi.restoreAllMocks())

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
    test('true reaches the handler', async () => {
      // A stand-in handler keeps this test independent of each lane's implementation.
      vi.spyOn(route, 'handler').mockImplementation(async () => new Response(null, { status: 204 }))
      expect((await invoke(route.path, options(), request())).status).toBe(204)
    })
    if (route.access === 'readResults') {
      test('explicit readResults overrides manage, also requiring literal true', async () => {
        const req = request()
        const allowed = options(false, vi.fn(async () => true))
        vi.spyOn(route, 'handler').mockImplementation(async () => new Response(null, { status: 204 }))
        expect((await invoke(route.path, allowed, req)).status).toBe(204)
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
  // The handler itself belongs to CORE-05; a sentinel proves the wrapper let the key through.
  vi.spyOn(ROUTES.find(route => route.path === '/xp/manifest')!, 'handler').mockImplementation(async () => new Response(null, { status: 204 }))
  expect((await invoke('/xp/manifest', options(), request(false, { 'x-xp-manifest-key': key }))).status).toBe(204)
})
test('signed cookie routes refuse absent or unsigned cookies before the handler (CORE-04 verification)', async () => {
  const cookieHeaders: Array<Record<string, string>> = [{}, { cookie: 'xp_id=unsigned' }]
  for (const headers of cookieHeaders) {
    await assertResponse(await invoke('/xp/events', options(), request(false, headers)), 401, 'unauthenticated')
  }
})
test('a validly signed cookie reaches the events handler', async () => {
  const opts = options()
  const cookie = unitCookie.encodeUnitCookie(unitCookie.mintUnitId(), opts.runtime.proxyRuntime.secrets)
  const response = await invoke('/xp/events', opts, request(false, { cookie: `xp_id=${cookie}` }))
  expect(response.status).not.toBe(401)
  expect(response.status).not.toBe(403)
})

test('transition stubs identify their owning lanes', async () => {
  const lanes = { start: 'CORE-10b', allocate: 'CORE-10b', 'add-metric': 'CORE-10b', stop: 'CORE-10b', decide: 'CORE-11', 'release-holdout': 'CORE-11', 'make-content': 'CORE-12', archive: 'CORE-11' }
  for (const [action, lane] of Object.entries(lanes)) {
    const response = await invoke(`/xp/experiments/:id/${action}`, options(), request())
    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({ errors: [{ code: 'not-implemented', message: lane }] })
  }
})

describe('handler error mapping', () => {
  const route = ROUTES.find(route => route.path === '/xp/experiments/:id/start')!
  test.each([
    new XpRefusal('invalid-status', 'Wrong status', { x: 1 }, 409),
    new XpRefusal('invalid-body', 'Bad input', { field: 'arms' }, 422),
    new XpRefusal('commit-unverified', 'Commit result unknown', null, 500),
    new XpRefusal('not-found', 'Unknown experiment', undefined, 404),
  ])('maps $code to its status and preserves defined detail', async refusal => {
    vi.spyOn(route, 'handler').mockRejectedValue(refusal)
    const response = await invoke(route.path, options(), request())
    expect(response.status).toBe(refusal.status)
    expect(await response.json()).toEqual({ errors: [{ code: refusal.code, message: refusal.message, ...(refusal.detail === undefined ? {} : { detail: refusal.detail }) }] })
  })
  test('maps a synchronous not-implemented throw to 501', async () => {
    vi.spyOn(route, 'handler').mockImplementation(() => { throw new XpNotImplemented('CORE-test') })
    const response = await invoke(route.path, options(), request())
    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({ errors: [{ code: 'not-implemented', message: 'CORE-test' }] })
  })
  test('rethrows unexpected errors for Payload to handle', async () => {
    const failure = new Error('unexpected')
    vi.spyOn(route, 'handler').mockRejectedValue(failure)
    await expect(invoke(route.path, options(), request())).rejects.toBe(failure)
  })
  test('access denial prevents handler execution', async () => {
    const handler = vi.spyOn(route, 'handler').mockRejectedValue(new Error('must not run'))
    await assertResponse(await invoke(route.path, options(), request(false)), 401, 'unauthenticated')
    await assertResponse(await invoke(route.path, options(false), request()), 403, 'forbidden')
    expect(handler).not.toHaveBeenCalled()
  })
})
describe('verified visitor context', () => {
  const route = ROUTES.find(route => route.access === 'signedCookie')!
  test('passes the verified visitor to the handler without sharing context across requests', async () => {
    const verifier = vi.spyOn(unitCookie, 'verifyUnitCookie').mockReturnValueOnce('visitor-one').mockReturnValueOnce('visitor-two')
    const handler = vi.spyOn(route, 'handler').mockImplementation(async () => Response.json({}))
    const opts = options()
    const endpoint = buildEndpoints({ options: opts }).find(endpoint => endpoint.path === route.path)!
    const req = request(false, { cookie: 'other=ignored; xp_id=signed-cookie; tail=value' })
    expect((await endpoint.handler(req)).status).toBe(200)
    expect(verifier).toHaveBeenCalledWith('signed-cookie', opts.runtime.proxyRuntime.secrets)
    expect(handler).toHaveBeenNthCalledWith(1, req, { options: opts, unit: { visitorId: 'visitor-one' } })
    const secondReq = request(false, { cookie: 'xp_id=second-cookie' })
    expect((await endpoint.handler(secondReq)).status).toBe(200)
    expect(handler).toHaveBeenNthCalledWith(2, secondReq, { options: opts, unit: { visitorId: 'visitor-two' } })
    expect(handler.mock.calls[0]?.[1].unit).toEqual({ visitorId: 'visitor-one' })
    expect(handler.mock.calls[0]?.[1]).not.toBe(handler.mock.calls[1]?.[1])
  })
  test('invalid cookies cannot reach the handler', async () => {
    vi.spyOn(unitCookie, 'verifyUnitCookie').mockReturnValue(null)
    const handler = vi.spyOn(route, 'handler')
    await assertResponse(await invoke(route.path, options(), request(false)), 401, 'unauthenticated')
    expect(handler).not.toHaveBeenCalled()
  })
  test('unexpected verification errors propagate', async () => {
    const failure = new Error('verification failed')
    vi.spyOn(unitCookie, 'verifyUnitCookie').mockImplementation(() => { throw failure })
    await expect(invoke(route.path, options(), request(false))).rejects.toBe(failure)
  })
  test('non-cookie handlers receive no visitor, even after a signed request', async () => {
    const opts = options()
    vi.spyOn(unitCookie, 'verifyUnitCookie').mockReturnValue('visitor')
    await invoke(route.path, opts, request(false))
    const manageRoute = ROUTES.find(route => route.access === 'manage')!
    const handler = vi.spyOn(manageRoute, 'handler').mockImplementation(async () => Response.json({}))
    const req = request()
    await invoke(manageRoute.path, opts, req)
    expect(handler).toHaveBeenCalledWith(req, { options: opts })
  })
})

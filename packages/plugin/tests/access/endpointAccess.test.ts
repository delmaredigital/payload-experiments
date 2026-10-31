import { createHmac } from 'node:crypto'
import type { Config } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { createExperimentsPlugin } from '../../src/plugin.js'
import * as cookie from '../../src/runtime/cookie.js'
import type { ExperimentsAccess } from '../../src/types/contracts.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'

// Independent inventory: adding a registered endpoint without classifying it fails.
const routes = [
  ['get', '/xp/manifest', 'manifestKey'],
  ['post', '/xp/events', 'signedCookie'],
  ['post', '/xp/experiments/:id/start', 'manage'],
  ['post', '/xp/experiments/:id/allocate', 'manage'],
  ['post', '/xp/experiments/:id/add-metric', 'manage'],
  ['post', '/xp/experiments/:id/stop', 'manage'],
  ['post', '/xp/experiments/:id/decide', 'manage'],
  ['post', '/xp/experiments/:id/release-holdout', 'manage'],
  ['post', '/xp/experiments/:id/make-content', 'manage'],
  ['post', '/xp/experiments/:id/archive', 'manage'],
  ['get', '/xp/experiments/:id/preflight', 'manage'],
  ['get', '/xp/experiments/:id/preview-token', 'manage'],
  ['get', '/xp/experiments/:id/results', 'readResults'],
  ['post', '/xp/experiments/:id/recompute', 'manage'],
  ['get', '/xp/experiments/summary', 'readResults'],
] as const

async function endpoints(value: unknown = true, results?: ExperimentsAccess) {
  const options = sampleOptions()
  options.access.manage = vi.fn(async () => value) as ExperimentsAccess
  options.access.readResults = results
  const config = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'] })
  return { options, endpoints: config.endpoints! }
}
afterEach(() => vi.restoreAllMocks())

test('every endpoint registered by the plugin appears exactly once in the inventory', async () => {
  const config = await endpoints()
  expect(config.endpoints.map(({ method, path }) => [method, path])).toEqual(routes.map(([method, path]) => [method, path]))
})

for (const [method, path, access] of routes) {
  if (access === 'manage' || access === 'readResults') {
    test(`${method} ${path}: anonymous 401, learner and truthy access 403, true reaches stub`, async () => {
      for (const value of [false, 'yes', {}, true]) {
        const config = await endpoints(value)
        const endpoint = config.endpoints.find(endpoint => endpoint.path === path)!
        const anonymous = await endpoint.handler(fakeReq())
        expect(anonymous.status).toBe(401)
        expect(config.options.access.manage).not.toHaveBeenCalled()
        const response = await endpoint.handler(fakeReq({ user: { id: 'learner' } }))
        expect(response.status).toBe(value === true ? 501 : 403)
        expect(await response.json()).toMatchObject({ errors: [{ code: value === true ? 'not-implemented' : 'forbidden' }] })
      }
    })
  } else if (access === 'manifestKey') {
    test(`${method} ${path}: requires the manifest credential regardless of user role`, async () => {
      const config = await endpoints('yes')
      const endpoint = config.endpoints.find(endpoint => endpoint.path === path)!
      expect((await endpoint.handler(fakeReq())).status).toBe(401)
      expect((await endpoint.handler(fakeReq({ user: { id: 'learner' } }))).status).toBe(401)
      const key = createHmac('sha256', config.options.runtime.proxyRuntime.secrets[0]!).update('xp:manifest-key').digest('hex')
      expect((await endpoint.handler(fakeReq({ headers: { 'x-xp-manifest-key': key } }))).status).toBe(501)
      expect(config.options.access.manage).not.toHaveBeenCalled()
    })
  } else {
    test(`${method} ${path}: requires a verified visitor cookie regardless of user role`, async () => {
      const config = await endpoints('yes')
      const endpoint = config.endpoints.find(endpoint => endpoint.path === path)!
      const verify = vi.spyOn(cookie, 'verifyUnitCookie').mockReturnValue(null)
      expect((await endpoint.handler(fakeReq())).status).toBe(401)
      expect((await endpoint.handler(fakeReq({ user: { id: 'learner' } }))).status).toBe(401)
      verify.mockReturnValue('verified-visitor')
      expect((await endpoint.handler(fakeReq({ headers: { cookie: 'xp=signed' } }))).status).toBe(501)
      expect(config.options.access.manage).not.toHaveBeenCalled()
    })
  }
}

test('results endpoints use an explicit readResults callback instead of manage', async () => {
  const config = await endpoints(false, () => true)
  for (const [, path, access] of routes) {
    if (access !== 'readResults') continue
    const endpoint = config.endpoints.find(endpoint => endpoint.path === path)!
    expect((await endpoint.handler(fakeReq({ user: { id: 'reader' } }))).status).toBe(501)
  }
  expect(config.options.access.manage).not.toHaveBeenCalled()
})

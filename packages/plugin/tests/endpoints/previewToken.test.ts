import { afterEach, expect, test, vi } from 'vitest'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { verifyPreviewToken } from '../../src/runtime/previewToken.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'

afterEach(() => vi.useRealTimers())
function setup(status = 'running', arm = 'variantA') {
  const options = sampleOptions()
  const payload = fakePayload({ collections: { 'xp-experiments': [{ id: 'exp', phase: 3, status, arms: [{ key: 'control' }, { key: 'variantA' }, { key: 'holdout' }] }] } })
  const req = fakeReq({ payload, user: { id: 5 }, routeParams: { id: 'exp' }, searchParams: new URLSearchParams({ arm }) })
  const route = buildEndpoints({ options }).find(route => route.path === '/xp/experiments/:id/preview-token')!
  return { options, payload, req, route }
}
test.each(['draft', 'running', 'stopped', 'decided'])('%s preview token binds the experiment, arm, phase and one-hour expiry', async status => {
  vi.useFakeTimers().setSystemTime(new Date('2026-10-31T00:00:00Z'))
  const { options, payload, req, route } = setup(status)
  const response = await route.handler(req)
  expect(route.method).toBe('get')
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.json()
  expect(Object.keys(body)).toEqual(['token'])
  const now = Math.floor(Date.now() / 1000)
  expect(verifyPreviewToken(body.token, options.runtime.proxyRuntime.secrets, now)).toEqual({ e: 'exp', a: 'variantA', p: 3, exp: now + 3600 })
  expect(verifyPreviewToken(body.token, ['wrong-secret'], now)).toBeNull()
  expect(verifyPreviewToken(body.token, options.runtime.proxyRuntime.secrets, now + 3600)).toBeNull()
  expect(payload.calls).toEqual([{ method: 'find', args: { collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: 'exp' } } } }])
  expect(payload.dbCalls).toEqual([])
})
test.each(['control', 'holdout'])('a configured %s arm can be previewed', async arm => {
  const { req, route, options } = setup('running', arm)
  const response = await route.handler(req)
  expect(verifyPreviewToken((await response.json()).token, options.runtime.proxyRuntime.secrets)?.a).toBe(arm)
})
test('an unknown experiment returns 404 not-found', async () => {
  const { req, route } = setup()
  req.routeParams = { id: 'missing' }
  const response = await route.handler(req)
  expect(response.status).toBe(404)
  expect((await response.json()).errors[0].code).toBe('not-found')
})
test.each(['', 'variantB', 'unknown'])('unknown or absent arm %j returns 400 invalid-body', async arm => {
  const { req, route } = setup('running', arm)
  const response = await route.handler(req)
  expect(response.status).toBe(400)
  expect((await response.json()).errors[0].code).toBe('invalid-body')
  expect(response.headers.get('cache-control')).toBe('no-store')
})
test('archived experiments return 409 invalid-status', async () => {
  const { req, route } = setup('archived')
  const response = await route.handler(req)
  expect(response.status).toBe(409)
  expect((await response.json()).errors[0].code).toBe('invalid-status')
})
test.each([null, false, { id: { equals: 5 } }])('manage access is required before any reads (%j)', async access => {
  const { options, req, payload } = setup()
  if (access === null) req.user = null
  else options.access.manage = (() => access) as typeof options.access.manage
  const route = buildEndpoints({ options }).find(route => route.path === '/xp/experiments/:id/preview-token')!
  expect((await route.handler(req)).status).toBe(access === null ? 401 : 403)
  expect(payload.calls).toEqual([])
})

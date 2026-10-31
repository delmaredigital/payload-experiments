import { expect, expectTypeOf, test, vi } from 'vitest'
import { defineExperimentsProxyRuntime } from '../../src/runtime/proxyRuntime.js'
import type { ExperimentsPluginOptions } from '../../src/types/contracts.js'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { defineExperimentsServerRuntime } from '../../src/server/serverRuntime.js'
import type { ExperimentsServerRuntime, ExperimentsServerRuntimeOptions } from '../../src/types/runtime.js'
import { defineFlagPoint, defineMetricSource } from '../../src/define.js'
import { XpNotImplemented, XpLockedFieldError, XpNoTransactionError, XpRefusal } from '../../src/errors.js'

test('proxy normalises secrets, defaults cookies, and freezes the config', () => {
  const runtime = defineExperimentsProxyRuntime({ secret: 'key', apiRoute: '/api' })
  expect(runtime.secrets).toEqual(['key'])
  expect(runtime.cookie).toEqual({ name: 'xp_id', maxAgeDays: 365 })
  expect(runtime.apiRoute).toBe('/api')
  expect(Object.isFrozen(runtime)).toBe(true)
  expect(Object.isFrozen(runtime.secrets)).toBe(true)
  expect(Object.isFrozen(runtime.cookie)).toBe(true)
  const secrets = ['current', 'old']
  const consent = vi.fn(() => false), loadManifest = vi.fn(), getUnit = vi.fn()
  const custom = defineExperimentsProxyRuntime({ secret: secrets, apiRoute: '/custom', cookie: { name: 'custom', maxAgeDays: 30, domain: '.example.com', consent }, loadManifest, getUnit })
  secrets.push('new')
  expect(custom.secrets).toEqual(['current', 'old'])
  expect(custom.cookie).toEqual({ name: 'custom', maxAgeDays: 30, domain: '.example.com', consent })
  expect(custom.loadManifest).toBe(loadManifest)
  expect(custom.getUnit).toBe(getUnit)
  expect(loadManifest).not.toHaveBeenCalled()
  expect(getUnit).not.toHaveBeenCalled()
})
test.each(['', ' ', [], [''], ['valid', '']])('empty secrets throw (%j)', secret => {
  expect(() => defineExperimentsProxyRuntime({ secret, apiRoute: '/api' })).toThrow('non-empty secret')
})
test('server payload is lazy; identity and attributes defaults are usable', () => {
  const getPayload = vi.fn()
  const proxy = defineExperimentsProxyRuntime({ secret: 'key', apiRoute: '/api' })
  const runtime = defineExperimentsServerRuntime(proxy, { getPayload })
  expect(getPayload).not.toHaveBeenCalled()
  expect(runtime.getPayload).toBe(getPayload)
  expect(runtime.proxyRuntime).toBe(proxy)
  const user = { id: 42 }
  expect(runtime.userIdOf(user)).toBe('42')
  expect(runtime.attributesOf(user)).toEqual({ loggedIn: true })
  expect(runtime.attributesOf(null)).toEqual({ loggedIn: false })
  const opts: ExperimentsServerRuntimeOptions = { getPayload, getUser: vi.fn(), userIdOf: vi.fn(() => 'opaque'), attributesOf: vi.fn(() => ({ staff: true })) }
  const custom = defineExperimentsServerRuntime(proxy, opts)
  expect(custom.getUser).toBe(opts.getUser)
  expect(custom.userIdOf).toBe(opts.userIdOf)
  expect(custom.attributesOf).toBe(opts.attributesOf)
})
test('definition helpers preserve identity and literal extensions', () => {
  const point = { id: 'point', label: 'Point', params: {}, defaultParams: {}, extension: true }
  expect(defineFlagPoint(point)).toBe(point)
  const metric = { id: 'metric', label: 'Metric', kind: 'binomial' as const, keyedBy: 'user' as const, query: vi.fn(async () => []) }
  expect(defineMetricSource(metric)).toBe(metric)
})
test('errors carry stable names and refusal metadata', () => {
  const errors = [new XpNotImplemented('ADM'), new XpLockedFieldError('arms', 'running'), new XpNoTransactionError(), new XpRefusal('invalid-body', 'Invalid', { field: 'arms' }, 422)]
  expect(errors.map(error => error.name)).toEqual(['XpNotImplemented', 'XpLockedFieldError', 'XpNoTransactionError', 'XpRefusal'])
  for (const error of errors) expect(error).toBeInstanceOf(Error)
  expect(errors[3]).toMatchObject({ code: 'invalid-body', message: 'Invalid', detail: { field: 'arms' }, status: 422 })
})

test('server runtime infers the host session user without a Payload collection', async () => {
  const user = { id: 'x', role: 'user', impersonatedBy: null }
  const proxy = defineExperimentsProxyRuntime({ secret: 'key', apiRoute: '/api' })
  const getPayload = vi.fn(), getUser = vi.fn(async () => user)
  const runtime = defineExperimentsServerRuntime(proxy, {
    getPayload,
    getUser,
    userIdOf: u => u.id,
    attributesOf: u => ({ loggedIn: Boolean(u), staff: Boolean(u && (u.role !== 'user' || u.impersonatedBy)) }),
  })
  const pluginOptions = { runtime, access: { manage: () => true } } satisfies ExperimentsPluginOptions<typeof user>
  expect(buildEndpoints({ options: pluginOptions })).toHaveLength(15)
  expectTypeOf(runtime).toEqualTypeOf<ExperimentsServerRuntime<typeof user>>()
  expectTypeOf<Parameters<typeof runtime.userIdOf>[0]>().toEqualTypeOf<typeof user>()
  expectTypeOf<NonNullable<ExperimentsServerRuntimeOptions<typeof user>['getUser']>>().returns.toEqualTypeOf<Promise<typeof user | null>>()
  expect(getPayload).not.toHaveBeenCalled()
  expect(getUser).not.toHaveBeenCalled()
  expect(await runtime.getUser?.()).toBe(user)
  expect(runtime.userIdOf(user)).toBe('x')
  expect(runtime.attributesOf(user)).toEqual({ loggedIn: true, staff: false })
  expect(runtime.attributesOf(null)).toEqual({ loggedIn: false, staff: false })
})
test('refusals support commit-unverified and not-found status codes', () => {
  expect(new XpRefusal('commit-unverified', 'Commit result unknown', undefined, 500)).toMatchObject({ code: 'commit-unverified', status: 500 })
  expect(new XpRefusal('not-found', 'Unknown experiment', undefined, 404)).toMatchObject({ code: 'not-found', status: 404 })
})

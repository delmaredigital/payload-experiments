import type { Config } from 'payload'
import { expect, test, vi } from 'vitest'
import { pageGuardBeforeChange, pageGuardAfterChange } from '../src/hooks/pageGuard.js'
import { contentChangesBeforeHook, contentChangesHook } from '../src/hooks/contentChanges.js'
import { createExperimentsPlugin } from '../src/plugin.js'
import { fakePayload } from './_fakes/payload.js'
import { fakeReq } from './_fakes/req.js'
import { sampleOptions } from './collections/fixtures.js'

test('adds collections, global, endpoints and resolved custom options without mutating config', async () => {
  const collection = { slug: 'pages', fields: [] }
  const global = { slug: 'settings', fields: [] }
  const endpoint = { path: '/host', method: 'get' as const, handler: () => Response.json({}) }
  const config: Config = { secret: 'test', db: {} as Config['db'], collections: [collection], globals: [global], endpoints: [endpoint], custom: { host: true } }
  const result = await createExperimentsPlugin(sampleOptions())(config)
  expect(result.collections?.map(c => c.slug)).toEqual(['xp-experiments', 'xp-metrics', 'pages', 'xp-phases', 'xp-layers', 'xp-events', 'xp-identities', 'xp-results-snapshots'])
  expect(result.globals?.map(g => g.slug)).toEqual(['settings', 'xp-state'])
  expect(result.endpoints).toHaveLength(24)
  expect(result.endpoints).toContainEqual(expect.objectContaining({ method: 'get', path: '/xp/editor-surface' }))
  expect(result.endpoints?.[0]).toBe(endpoint)
  expect(result.custom).toMatchObject({ host: true, xp: { events: { retentionDays: 180 }, puck: { collections: [] } } })
  expect(config.collections).toEqual([collection])
  expect(config.globals).toEqual([global])
  expect(config.endpoints).toEqual([endpoint])
  expect(config.custom).toEqual({ host: true })
})

test('host onInit runs before plugin checks, with the same payload', async () => {
  const payload = fakePayload()
  const onInit = vi.fn(async () => {
    expect(payload.dbCalls).toEqual([])
    Object.assign(payload.db, { packageName: '@payloadcms/db-postgres' })
  })
  const config = await createExperimentsPlugin(sampleOptions())({ secret: 'test', db: {} as Config['db'], onInit })
  await config.onInit!(payload)
  expect(onInit).toHaveBeenCalledWith(payload)
  expect(payload.dbCalls.map(call => call.method)).toEqual(['beginTransaction', 'rollbackTransaction'])
})

test('appends contentChangesHook to listed collections while preserving existing hooks', async () => {
  const previous = vi.fn()
  const beforeChange = vi.fn()
  const pages = { slug: 'pages', fields: [], hooks: { afterChange: [previous], beforeChange: [beforeChange] } }
  const posts = { slug: 'posts', fields: [] }
  const options = sampleOptions()
  options.puck = { enabled: true, collections: ['pages'] }
  const config = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'], collections: [pages, posts] })
  expect(config.collections?.[2]?.hooks?.afterChange).toEqual([previous, pageGuardAfterChange, contentChangesHook])
  expect(config.collections?.[2]?.hooks?.beforeChange).toEqual([beforeChange, pageGuardBeforeChange, contentChangesBeforeHook, expect.any(Function)])
  expect(config.collections?.[3]).toBe(posts)
  expect(pages.hooks.afterChange).toEqual([previous])
})

test('unknown puck collection fails at config time', async () => {
  const options = sampleOptions()
  options.puck = { enabled: true, collections: ['missing'] }
  expect(() => createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'] })).toThrow('Unknown experiments puck collection: missing')
})

test('object registrations install the wrapped hook and retain the custom field', async () => {
  const options = sampleOptions()
  options.puck = { enabled: true, collections: [{ slug: 'templates', field: 'content' }] }
  const config = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'], collections: [{ slug: 'templates', fields: [] }] })
  expect(config.collections?.[2]?.hooks?.afterChange).toEqual([pageGuardAfterChange, contentChangesHook])
  expect(config.custom?.xp.puck.collections).toEqual([{ slug: 'templates', field: 'content' }])
})

test('disabled puck leaves the listed collection hooks alone', async () => {
  const previous = vi.fn()
  const pages = { slug: 'pages', fields: [], hooks: { afterChange: [previous] } }
  const options = sampleOptions()
  options.puck = { enabled: false, collections: ['pages'] }
  const config = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'], collections: [pages] })
  expect(config.collections?.[2]).toBe(pages)
  expect(pages.hooks.afterChange).toEqual([previous])
})

test('fake requests default to POST only when a body is supplied', () => {
  expect(fakeReq().method).toBe('GET')
  expect(fakeReq({ body: '{}' }).method).toBe('POST')
  expect(fakeReq({ body: '{}', method: 'PATCH' }).method).toBe('PATCH')
})

test('non-Puck draft-enabled host collections get no content-change hooks (CORE-12b F5)', async () => {
  const afterChange = vi.fn()
  const beforeChange = vi.fn()
  const config = await createExperimentsPlugin(sampleOptions())({ secret: 'test', db: {} as Config['db'], collections: [{
    slug: 'asks', fields: [], versions: { drafts: {} }, hooks: { beforeChange: [beforeChange], afterChange: [afterChange] },
  }] })
  expect(config.collections?.[2]?.hooks?.beforeChange).toEqual([beforeChange])
  expect(config.collections?.[2]?.hooks?.afterChange).toEqual([afterChange])
})

test('registers the Tests root without injecting deprecated nav or dashboard components without replacing host config or leaking callbacks', async () => {
  const options = sampleOptions()
  options.admin = { editorUrl: () => '/editor', previewUrl: () => '/preview', descriptions: { block: 'On a page' } }
  const admin: NonNullable<Config['admin']> = { custom: { host: true }, components: {
    views: { host: { Component: 'host#View', path: '/host' } }, beforeDashboard: ['host#Dashboard'], beforeNavLinks: ['host#BeforeNav'], afterNavLinks: ['host#Nav'],
  } }
  const config = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'], admin })
  const paths = await import('../src/admin/paths.js')
  expect(config.admin?.components?.views).toEqual({ host: admin.components!.views!.host, xpTests: { Component: paths.XP_TESTS_VIEW, path: '/experiments/:segments*' } })
  expect(config.admin?.components?.beforeDashboard).toEqual(['host#Dashboard'])
  expect(admin.components?.beforeDashboard).toEqual(['host#Dashboard'])
  expect(config.admin?.components?.beforeNavLinks).toEqual(['host#BeforeNav'])
  expect(config.admin?.dependencies).not.toHaveProperty('xpTestsNav')
  expect(config.admin?.components?.afterNavLinks).toEqual(['host#Nav'])
  expect(admin.components?.beforeNavLinks).toEqual(['host#BeforeNav'])
  expect(config.admin?.custom).toEqual({ host: true })
  expect(config.custom?.xp.admin).toEqual(options.admin)
  expect(admin.components?.afterNavLinks).toEqual(['host#Nav'])
  expect(admin.components?.views).not.toHaveProperty('xpTests')
})

test('applying the plugin twice leaves host dashboard and nav components alone', async () => {
  const plugin = createExperimentsPlugin(sampleOptions())
  const first = await plugin({ secret: 'test', db: {} as Config['db'], admin: { components: {
    beforeDashboard: ['host#Dashboard'], beforeNavLinks: ['host#BeforeNav'],
  } } })
  const second = await plugin(first)
  expect(second.admin?.components?.beforeDashboard).toEqual(['host#Dashboard'])
  expect(second.admin?.components?.beforeNavLinks).toEqual(['host#BeforeNav'])
})

test('page and Puck registrations compose once while preserving host hooks', async () => {
  const { pageGuardAfterOperation, pageGuardBeforeChange, pageGuardBeforeDelete, pageGuardEnterOperation, pageGuardBeforeOperation } = await import('../src/hooks/pageGuard.js')
  const host = vi.fn(), options = sampleOptions()
  options.puck = { enabled: true, collections: ['pages'] }
  options.pages = { collections: [{ slug: 'pages', pathOf: () => '/', findByPath: async () => null }] }
  const config = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'], collections: [{ slug: 'pages', fields: [], hooks: { beforeChange: [host], beforeDelete: [host], beforeOperation: [host] } }] })
  const hooks = config.collections![2]!.hooks!
  expect(hooks.beforeChange).toEqual([host, pageGuardBeforeChange, contentChangesBeforeHook, expect.any(Function)])
  expect(hooks.beforeDelete).toEqual([host, pageGuardBeforeDelete])
  expect(hooks.beforeOperation).toEqual([pageGuardEnterOperation, host, pageGuardBeforeOperation])
  expect(hooks.afterOperation).toEqual([pageGuardAfterOperation])
  expect(hooks.afterChange).toEqual([pageGuardAfterChange, contentChangesHook])
})
test('unknown page collection fails at config time', () => {
  const options = sampleOptions()
  options.pages = { collections: [{ slug: 'missing', pathOf: () => '/', findByPath: async () => null }] }
  expect(() => createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'] })).toThrow('Unknown experiments page collection: missing')
})

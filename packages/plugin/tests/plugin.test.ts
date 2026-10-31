import type { Config } from 'payload'
import { expect, test, vi } from 'vitest'
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
  expect(result.collections?.map(c => c.slug)).toEqual(['pages', 'xp-experiments', 'xp-phases', 'xp-layers', 'xp-metrics', 'xp-events', 'xp-identities', 'xp-results-snapshots'])
  expect(result.globals?.map(g => g.slug)).toEqual(['settings', 'xp-state'])
  expect(result.endpoints).toHaveLength(16)
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
  expect(config.collections?.[0]?.hooks?.afterChange).toEqual([previous, contentChangesHook])
  expect(config.collections?.[0]?.hooks?.beforeChange).toEqual([beforeChange, contentChangesBeforeHook])
  expect(config.collections?.[1]).toBe(posts)
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
  expect(config.collections?.[0]?.hooks?.afterChange).toEqual([contentChangesHook])
  expect(config.custom?.xp.puck.collections).toEqual([{ slug: 'templates', field: 'content' }])
})

test('disabled puck leaves the listed collection hooks alone', async () => {
  const previous = vi.fn()
  const pages = { slug: 'pages', fields: [], hooks: { afterChange: [previous] } }
  const options = sampleOptions()
  options.puck = { enabled: false, collections: ['pages'] }
  const config = await createExperimentsPlugin(options)({ secret: 'test', db: {} as Config['db'], collections: [pages] })
  expect(config.collections?.[0]).toBe(pages)
  expect(pages.hooks.afterChange).toEqual([previous])
})

test('fake requests default to POST only when a body is supplied', () => {
  expect(fakeReq().method).toBe('GET')
  expect(fakeReq({ body: '{}' }).method).toBe('POST')
  expect(fakeReq({ body: '{}', method: 'PATCH' }).method).toBe('PATCH')
})

test('draft-enabled arm-select hosts get baseline capture without a Puck afterChange hook', async () => {
  const afterChange = vi.fn()
  const beforeChange = vi.fn()
  const config = await createExperimentsPlugin(sampleOptions())({ secret: 'test', db: {} as Config['db'], collections: [{
    slug: 'asks', fields: [], versions: { drafts: {} }, hooks: { beforeChange: [beforeChange], afterChange: [afterChange] },
  }] })
  expect(config.collections?.[0]?.hooks?.beforeChange).toEqual([beforeChange, contentChangesBeforeHook])
  expect(config.collections?.[0]?.hooks?.afterChange).toEqual([afterChange])
})

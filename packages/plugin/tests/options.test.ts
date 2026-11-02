import { expect, test } from 'vitest'
import { DEFAULT_MAX_BODY_BYTES } from '../src/constants.js'
import { puckCollections, resolveOptions } from '../src/options.js'
import type { ExperimentsPluginOptions } from '../src/types/contracts.js'
import { sampleOptions } from './collections/fixtures.js'

test('resolves access, events and puck defaults without mutating the input', () => {
  const input: ExperimentsPluginOptions = sampleOptions()
  const options = resolveOptions(input)
  expect(options.access).toEqual({ manage: input.access.manage, admin: input.access.manage, readResults: input.access.manage, readIdentities: input.access.manage })
  expect(options.events).toEqual({ retentionDays: 180, maxBodyBytes: DEFAULT_MAX_BODY_BYTES, dimensions: [] })
  expect(options.puck).toEqual({ enabled: false, collections: [] })
  expect(input.access.admin).toBeUndefined()
  expect(input.events).toBeUndefined()
  expect(input.puck).toBeUndefined()
  expect(options.flagPoints).not.toBe(input.flagPoints)
  expect(options.attributeKeys).not.toBe(input.attributeKeys)
  expect(options.attributeKeys?.country?.values).not.toBe(input.attributeKeys?.country?.values)
})

test('preserves overrides and defaults identities to admin', () => {
  const input: ExperimentsPluginOptions = sampleOptions()
  const admin = () => false, readResults = () => true, rateLimit = () => false
  input.access = { manage: input.access.manage, admin, readResults }
  input.events = { retentionDays: 30, maxBodyBytes: 1024, rateLimit }
  input.puck = { enabled: true, collections: ['pages'] }
  const options = resolveOptions(input)
  expect(options.access).toEqual({ ...input.access, readIdentities: admin })
  expect(options.events).toEqual({ ...input.events, dimensions: [] })
  expect(options.puck).toEqual({ enabled: true, collections: [{ slug: 'pages', field: 'puckData' }] })
  expect(options.puck?.collections).not.toBe(input.puck.collections)
  const readIdentities = () => true
  expect(resolveOptions({ ...input, access: { ...input.access, readIdentities } }).access.readIdentities).toBe(readIdentities)
})

test('optional registrations default to empty containers', () => {
  const { runtime, access } = sampleOptions()
  expect(resolveOptions({ runtime, access })).toMatchObject({ flagPoints: [], metricSources: [], eventSources: [], attributeKeys: {} })
})

test.each([undefined, null, true, 'yes', {}])('requires a manage function (%j)', manage => {
  const input = { ...sampleOptions(), access: { manage } } as unknown as ExperimentsPluginOptions
  expect(() => resolveOptions(input)).toThrow('access.manage must be a function')
})

test('rejects duplicate flag ids', () => {
  const input = sampleOptions()
  input.flagPoints = [input.flagPoints![0]!, { ...input.flagPoints![0]! }]
  expect(() => resolveOptions(input)).toThrow('flag point ids must be unique')
})

test.each(['Signup', 'a-b', 'has space', '', 'a.b'])('rejects invalid event source %j', name => {
  expect(() => resolveOptions({ ...sampleOptions(), eventSources: [name] })).toThrow('event source names')
  expect(() => resolveOptions({ ...sampleOptions(), eventSources: [{ name, clientWritable: false }] })).toThrow('Experiments event source names must match /^[a-z0-9_]+$/')
})

test('normalises mixed event source forms without mutating registrations', () => {
  const input = { ...sampleOptions(), eventSources: ['signup', { name: 'donation_completed', clientWritable: false }, { name: 'checkout_2', clientWritable: true }] }
  const options = resolveOptions(input)
  expect(options.eventSources).toEqual([
    { name: 'signup', clientWritable: true }, { name: 'donation_completed', clientWritable: false }, { name: 'checkout_2', clientWritable: true },
  ])
  expect(options.eventSources).not.toBe(input.eventSources)
  expect(options.eventSources![1]).not.toBe(input.eventSources[1])
  expect(input.eventSources).toEqual(['signup', { name: 'donation_completed', clientWritable: false }, { name: 'checkout_2', clientWritable: true }])
})

test.each(['false', undefined, 1])('rejects non-boolean event clientWritable (%j)', clientWritable => {
  const input = { ...sampleOptions(), eventSources: [{ name: 'signup', clientWritable }] } as unknown as ExperimentsPluginOptions
  expect(() => resolveOptions(input)).toThrow('event source clientWritable must be a boolean')
})

test.each([null, undefined, 1, false, [], {}])('rejects invalid event source entries (%j)', entry => {
  const input = { ...sampleOptions(), eventSources: [entry] } as unknown as ExperimentsPluginOptions
  expect(() => resolveOptions(input)).toThrow('event source names')
})

test.each([
  ['signup', 'signup'],
  ['signup', { name: 'signup', clientWritable: false }],
  [{ name: 'signup', clientWritable: false }, { name: 'signup', clientWritable: true }],
])('rejects duplicate event source names (%j, %j)', (...eventSources) => {
  expect(() => resolveOptions({ ...sampleOptions(), eventSources })).toThrow('event source names must be unique')
})

test('accepts typed unique attribute keys and valid event source names', () => {
  const input = { ...sampleOptions(), eventSources: ['signup', 'checkout_2'], attributeKeys: { country: { type: 'string' as const, values: ['US'] }, age: { type: 'number' as const }, staff: { type: 'boolean' as const } } }
  expect(resolveOptions(input).attributeKeys).toEqual(input.attributeKeys)
})

test.each([{ country: { type: 'object' } }, { country: { type: 'string', values: [1] } }, { '': { type: 'number' } }])('rejects invalid attribute declarations (%j)', attributeKeys => {
  expect(() => resolveOptions({ ...sampleOptions(), attributeKeys } as unknown as ExperimentsPluginOptions)).toThrow(/attribute/)
})

test.each(['maxBodyBytes', 'retentionDays'] as const)('validates events.%s', key => {
  for (const value of [NaN, Infinity, -Infinity, -1, 0, 1.5]) {
    expect(() => resolveOptions({ ...sampleOptions(), events: { [key]: value } })).toThrow(`events.${key} must be a finite positive integer`)
  }
  expect(resolveOptions({ ...sampleOptions(), events: { [key]: 1 } }).events?.[key]).toBe(1)
})

test('puck defaults enabled to true when collections are registered', () => {
  const input = { ...sampleOptions(), puck: { collections: ['pages'] } } as ExperimentsPluginOptions
  expect(resolveOptions(input).puck).toEqual({ enabled: true, collections: [{ slug: 'pages', field: 'puckData' }] })
  expect(resolveOptions({ ...input, puck: { enabled: false, collections: ["pages"] } }).puck?.enabled).toBe(false)
})

test('normalises mixed collection forms once without mutating registrations', () => {
  const input = { ...sampleOptions(), puck: { enabled: true, collections: ['pages', { slug: 'templates', field: 'content' }, { slug: 'posts' }] } }
  const options = resolveOptions(input)
  expect(puckCollections(options)).toEqual([{ slug: 'pages', field: 'puckData' }, { slug: 'templates', field: 'content' }, { slug: 'posts', field: 'puckData' }])
  expect(puckCollections(options)).toBe(options.puck?.collections)
  expect(puckCollections(options)).toBe(puckCollections(options))
  expect(input.puck.collections).toEqual(['pages', { slug: 'templates', field: 'content' }, { slug: 'posts' }])
})


test('copies configured dimension names without mutating the host options', () => {
  const dimensions = ['registrationSource', 'loggedIn']
  const options = resolveOptions({ ...sampleOptions(), events: { dimensions } })
  expect(options.events?.dimensions).toEqual(dimensions)
  expect(options.events?.dimensions).not.toBe(dimensions)
})

test.each([undefined, {}, { descriptions: {} }, { descriptions: { setting: 'A setting' } }, {
  editorUrl: () => '/editor', previewUrl: () => '/preview', descriptions: { block: 'Block', document: 'Document', setting: 'Setting' },
}])('accepts optional admin configuration (%j)', admin => {
  expect(resolveOptions({ ...sampleOptions(), admin }).admin).toEqual(admin)
})

test.each([
  [null, 'admin must be an object'], [[], 'admin must be an object'], ['bad', 'admin must be an object'],
  [{ editorUrl: '/editor' }, 'admin.editorUrl must be a function'], [{ previewUrl: null }, 'admin.previewUrl must be a function'],
  [{ descriptions: null }, 'admin.descriptions must be an object'], [{ descriptions: [] }, 'admin.descriptions must be an object'],
  [{ descriptions: { block: 12 } }, 'admin.descriptions.block must be a string'],
  [{ descriptions: { document: false } }, 'admin.descriptions.document must be a string'],
  [{ descriptions: { setting: null } }, 'admin.descriptions.setting must be a string'],
  [{ surprise: true }, 'Unknown experiments admin option: surprise'],
  [{ descriptions: { surprise: 'bad' } }, 'Unknown experiments admin.descriptions option: surprise'],
])('rejects invalid admin configuration (%j)', (admin, message) => {
  expect(() => resolveOptions({ ...sampleOptions(), admin } as unknown as ExperimentsPluginOptions)).toThrow(message)
})

test.each([null, 12, false, {}])('rejects non-string flag point description (%j)', description => {
  const options = sampleOptions()
  Object.assign(options.flagPoints![0]!, { description })
  expect(() => resolveOptions(options)).toThrow('flag point description must be a string')
})

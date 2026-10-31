import { expect, test } from 'vitest'
import { DEFAULT_MAX_BODY_BYTES } from '../src/constants.js'
import { resolveOptions } from '../src/options.js'
import type { ExperimentsPluginOptions } from '../src/types/contracts.js'
import { sampleOptions } from './collections/fixtures.js'

test('resolves access, events and puck defaults without mutating the input', () => {
  const input = sampleOptions()
  const options = resolveOptions(input)
  expect(options.access).toEqual({ manage: input.access.manage, admin: input.access.manage, readResults: input.access.manage, readIdentities: input.access.manage })
  expect(options.events).toEqual({ retentionDays: 180, maxBodyBytes: DEFAULT_MAX_BODY_BYTES })
  expect(options.puck).toEqual({ enabled: false, collections: [] })
  expect(input.access.admin).toBeUndefined()
  expect(input.events).toBeUndefined()
  expect(input.puck).toBeUndefined()
  expect(options.flagPoints).not.toBe(input.flagPoints)
  expect(options.attributeKeys).not.toBe(input.attributeKeys)
  expect(options.attributeKeys?.country?.values).not.toBe(input.attributeKeys?.country?.values)
})

test('preserves overrides and defaults identities to admin', () => {
  const input = sampleOptions()
  const admin = () => false, readResults = () => true, rateLimit = () => false
  input.access = { manage: input.access.manage, admin, readResults }
  input.events = { retentionDays: 30, maxBodyBytes: 1024, rateLimit }
  input.puck = { enabled: true, collections: ['pages'] }
  const options = resolveOptions(input)
  expect(options.access).toEqual({ ...input.access, readIdentities: admin })
  expect(options.events).toEqual(input.events)
  expect(options.puck).toEqual(input.puck)
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
})

test('accepts typed unique attribute keys and valid event source names', () => {
  const input = { ...sampleOptions(), eventSources: ['signup', 'checkout_2'], attributeKeys: { country: { type: 'string' as const, values: ['US'] }, age: { type: 'number' as const }, staff: { type: 'boolean' as const } } }
  expect(resolveOptions(input).attributeKeys).toEqual(input.attributeKeys)
})

test.each([{ country: { type: 'object' } }, { country: { type: 'string', values: [1] } }, { '': { type: 'number' } }])('rejects invalid attribute declarations (%j)', attributeKeys => {
  expect(() => resolveOptions({ ...sampleOptions(), attributeKeys } as unknown as ExperimentsPluginOptions)).toThrow(/attribute/)
})

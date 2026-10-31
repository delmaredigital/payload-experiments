import { afterEach, expect, test, vi } from 'vitest'
import { integrationConnectionString, validateIntegrationConnectionString } from '../tests-integration/harness.js'

afterEach(() => vi.unstubAllEnvs())

test('requires an explicit integration database URL', () => {
  expect(() => validateIntegrationConnectionString(undefined)).toThrow('INTEGRATION_DATABASE_URL is required')
  vi.stubEnv('INTEGRATION_DATABASE_URL', undefined)
  expect(() => integrationConnectionString()).toThrow('INTEGRATION_DATABASE_URL is required')
})

test.each(['DATABASE_URL', 'CC_NXT_DATABASE_URL'] as const)('refuses the configured %s', key => {
  const url = 'postgres://example.test/xp_it'
  expect(() => validateIntegrationConnectionString(url, { [key]: url })).toThrow('must differ from host databases')
  vi.stubEnv('INTEGRATION_DATABASE_URL', url)
  vi.stubEnv(key, url)
  expect(() => integrationConnectionString()).toThrow('must differ from host databases')
})

test.each(['postgres://example.test/prod', 'postgres://example.test/prod?database=xp_it', 'postgres://example.test/'])('refuses a non-test path database (%s)', url => {
  expect(() => validateIntegrationConnectionString(url)).toThrow('database name must contain test or xp_it')
})

test.each(['mysql://example.test/xp_it', 'invalid-url'])('refuses an invalid Postgres URL (%s)', url => {
  expect(() => validateIntegrationConnectionString(url)).toThrow('Invalid integration database URL')
})

test.each(['postgres://example.test/xp_it', 'postgres://example.test/xp_it?database=prod', 'postgresql://example.test/plugin_test'])('accepts the path test database (%s)', url => {
  expect(validateIntegrationConnectionString(url)).toBe(url)
})

import { expect, test } from 'vitest'
import { cookieAttributes, encodeUnitCookie, mintUnitId, verifyUnitCookie } from '../../src/runtime/cookie.js'
import { defineExperimentsProxyRuntime } from '../../src/runtime/proxyRuntime.js'

test('minted ids contain 128 random bits and cookies round trip through rotation', () => {
  const ids = Array.from({ length: 100 }, mintUnitId)
  expect(new Set(ids).size).toBe(100)
  for (const id of ids) {
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(Buffer.from(id, 'base64url')).toHaveLength(16)
    expect(verifyUnitCookie(encodeUnitCookie(id, ['old']), ['new', 'old'])).toBe(id)
  }
})
test('tampered, truncated, wrong-secret and malformed cookies return null without throwing', () => {
  const cookie = encodeUnitCookie('visitor', ['key'])
  for (const invalid of [undefined, '', 'unsigned', cookie.slice(0, -1), cookie.replace('visitor', 'attacker'), `${cookie}.extra`, `.${cookie}`, `${cookie}\n`]) {
    expect(verifyUnitCookie(invalid, ['key'])).toBeNull()
  }
  expect(verifyUnitCookie(cookie, ['wrong'])).toBeNull()
  expect(verifyUnitCookie(cookie, [])).toBeNull()
  expect(() => encodeUnitCookie('id.with.dot', ['key'])).toThrow()
})
test('cookie attributes use seconds, defaults and Secure only on https', () => {
  const runtime = defineExperimentsProxyRuntime({ secret: 'key', apiRoute: '/api' })
  expect(cookieAttributes(runtime, { https: false })).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 86400 })
  const custom = defineExperimentsProxyRuntime({ secret: 'key', apiRoute: '/api', cookie: { maxAgeDays: 30, domain: '.example.com' } })
  expect(cookieAttributes(custom, { https: true })).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400, domain: '.example.com', secure: true })
  expect(cookieAttributes(custom, { https: false })).not.toHaveProperty('secure')
})

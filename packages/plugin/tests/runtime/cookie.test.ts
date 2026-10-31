import { expect, test } from 'vitest'
import { NextRequest } from 'next/server.js'
import { cookieAttributes, encodeUnitCookie, mintUnitId, readUnitCookie, verifyUnitCookie } from '../../src/runtime/cookie.js'
import { defineExperimentsProxyRuntime } from '../../src/runtime/proxyRuntime.js'
import { signPreviewToken, verifyPreviewToken } from '../../src/runtime/previewToken.js'
import { sign } from '../../src/runtime/signing.js'

test.each(['headers', 'request'])('signed-cookie reader chooses the last named cookie from %s with rotating secrets', mode => {
  const runtime = defineExperimentsProxyRuntime({ secret: ['new', 'old'], apiRoute: '/api', cookie: { name: 'custom_xp' } })
  const headers = new Headers({ cookie: `xp_id=ignored; custom_xp=${encodeUnitCookie('first', ['new'])}; custom_xp=${encodeUnitCookie('last', ['old'])}` })
  const input = () => mode === 'headers' ? headers : new NextRequest('https://example.test/', { headers })
  expect(readUnitCookie(input(), runtime)).toBe('last')
  headers.set('cookie', `custom_xp=${encodeUnitCookie('first', ['new'])}; custom_xp=unsigned`)
  expect(readUnitCookie(input(), runtime)).toBeNull()
  headers.delete('cookie')
  expect(readUnitCookie(input(), runtime)).toBeNull()
})

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
test('cookie and preview MACs are domain-separated even with identical valid bodies', () => {
  const now = 1_800_000_000, secrets = ['key']
  const preview = signPreviewToken({ e: 'experiment', a: 'variantA', p: 1, exp: now + 3600 }, secrets, now)
  const [body, previewMac] = preview.split('.')
  const cookie = encodeUnitCookie(body!, secrets)
  expect(verifyUnitCookie(preview, secrets)).toBeNull()
  expect(verifyPreviewToken(cookie, secrets, now)).toBeNull()
  expect(cookie).toBe(`${body}.${sign(`xp:unit:${body}`, secrets)}`)
  expect(previewMac).toBe(sign(`xp:preview:${body}`, secrets))
  expect(verifyUnitCookie(cookie, secrets)).toBe(body)
  expect(verifyPreviewToken(preview, secrets, now)).not.toBeNull()
  // Previously signed untagged values cannot cross into either codec.
  const untagged = `${body}.${sign(body!, secrets)}`
  expect(verifyUnitCookie(untagged, secrets)).toBeNull()
  expect(verifyPreviewToken(untagged, secrets, now)).toBeNull()
})

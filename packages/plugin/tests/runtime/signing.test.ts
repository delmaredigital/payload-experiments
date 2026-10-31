import { createHmac } from 'node:crypto'
import { expect, test } from 'vitest'
import { sign, verify } from '../../src/runtime/signing.js'

test('HMAC-SHA256 is base64url and uses the first secret', () => {
  expect(sign('payload', ['new', 'old'])).toBe(createHmac('sha256', 'new').update('payload').digest('base64url'))
  expect(sign('payload', ['new'])).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(() => sign('payload', [])).toThrow()
})
test('rotation accepts old and new signatures; changes and malformed MACs fail closed', () => {
  for (const key of ['new', 'old']) expect(verify('payload', sign('payload', [key]), ['new', 'old'])).toBe(true)
  const mac = sign('payload', ['old'])
  expect(verify('tampered', mac, ['new', 'old'])).toBe(false)
  expect(verify('payload', mac, ['wrong'])).toBe(false)
  expect(verify('payload', mac, [])).toBe(false)
  for (const invalid of ['', mac.slice(1), `${mac}=`, '!'.repeat(43), 'A'.repeat(44)]) expect(verify('payload', invalid, ['old'])).toBe(false)
})

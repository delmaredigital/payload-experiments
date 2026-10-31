import { expect, test } from 'vitest'
import { signPreviewToken, verifyPreviewToken } from '../../src/runtime/previewToken.js'
import { sign } from '../../src/runtime/signing.js'

const now = 1_800_000_000
const token = { e: 'experiment-id', a: 'variantA', p: 1, exp: now + 3600 }
test('preview tokens round trip with rotation and have a maximum one-hour lifetime', () => {
  const value = signPreviewToken(token, ['old'], now)
  expect(verifyPreviewToken(value, ['new', 'old'], now)).toEqual(token)
  expect(verifyPreviewToken(value, ['wrong'], now)).toBeNull()
  expect(verifyPreviewToken(value, ['old'], token.exp)).toBeNull()
  expect(verifyPreviewToken(value, ['old'], now - 1)).toBeNull()
  expect(() => signPreviewToken({ ...token, exp: now + 3601 }, ['old'], now)).toThrow()
  expect(() => signPreviewToken({ ...token, exp: now }, ['old'], now)).toThrow()
  expect(verifyPreviewToken(signPreviewToken({ ...token, e: 42 }, ['old'], now), ['old'], now)?.e).toBe(42)
  expect(verifyPreviewToken(signPreviewToken({ ...token, p: 0 }, ['old'], now), ['old'], now)?.p).toBe(0)
})
test('tamper, truncation, malformed JSON and signed invalid payloads are rejected', () => {
  const value = signPreviewToken(token, ['key'], now)
  expect(verifyPreviewToken(`A${value.slice(1)}`, ['key'], now)).toBeNull()
  for (const invalid of ['', value.slice(1), value.slice(0, -1), `${value}.extra`]) expect(verifyPreviewToken(invalid, ['key'], now)).toBeNull()
  for (const raw of ['{', 'null', '[]', JSON.stringify({ ...token, p: -1 }), JSON.stringify({ ...token, a: 'unknown' }), JSON.stringify({ ...token, exp: 'tomorrow' }), JSON.stringify({ ...token, extra: true })]) {
    const body = Buffer.from(raw).toString('base64url')
    expect(verifyPreviewToken(`${body}.${sign(`xp:preview:${body}`, ['key'])}`, ['key'], now)).toBeNull()
  }
})

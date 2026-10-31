import { afterEach, expect, test, vi } from 'vitest'
import { idempotencyKey } from '../../src/client/idempotency.js'
import { __resetBeaconsForTests } from '../../src/client/beacon.js'

afterEach(__resetBeaconsForTests)
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('caller key wins; an empty string counts as absent; randomUUID is preferred otherwise', () => {
  const randomUUID = vi.fn(() => 'uuid-key')
  const getRandomValues = vi.fn()
  vi.stubGlobal('crypto', { randomUUID, getRandomValues })
  expect(idempotencyKey('stable-key')).toBe('stable-key')
  expect(randomUUID).not.toHaveBeenCalled()
  expect(idempotencyKey('')).toBe('uuid-key')
  expect(idempotencyKey()).toBe('uuid-key')
  expect(getRandomValues).not.toHaveBeenCalled()
})

test.each(['absent', 'throws'])('randomUUID %s falls back to exactly 16 random bytes encoded as hex', state => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => {
    expect(bytes).toHaveLength(16)
    bytes.set(Array.from({ length: 16 }, (_, i) => i))
    return bytes
  })
  vi.stubGlobal('crypto', { getRandomValues, ...(state === 'throws' ? { randomUUID: () => { throw new Error('restricted') } } : {}) })
  expect(idempotencyKey()).toBe('000102030405060708090a0b0c0d0e0f')
})

test.each(['missing', 'absent-methods', 'throwing'])('crypto %s still yields a nonempty key without throwing', state => {
  vi.stubGlobal('crypto', state === 'missing' ? undefined : state === 'absent-methods' ? {} : {
    randomUUID() { throw new Error('restricted') }, getRandomValues() { throw new Error('restricted') },
  })
  vi.spyOn(Date, 'now').mockReturnValue(1000)
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  expect(() => idempotencyKey()).not.toThrow()
  expect(idempotencyKey()).toBe((1000).toString(36) + (0.5).toString(36).slice(2))
})

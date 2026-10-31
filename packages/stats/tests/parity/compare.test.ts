import { describe, expect, it } from 'vitest'
import { expectParity } from './compare.js'
import { decode } from './fixtures.js'

describe('expectParity', () => {
  it('accepts the exact relative tolerance boundary and rejects values beyond it', () => {
    // Both operands and their difference are exactly representable: 1e9 * 1e-9 = 1.
    expectParity(1_000_000_001, 1_000_000_000)
    expectParity(999_999_999, 1_000_000_000)
    expect(() => expectParity(1_000_000_001.001, 1_000_000_000)).toThrow()
  })

  it('uses absolute tolerance when the expected magnitude is below one', () => {
    expectParity(1e-9, 0)
    expectParity(0.125 + 0.5e-9, 0.125)
    expect(() => expectParity(2e-9, 0)).toThrow()
  })

  it('matches NaN only to NaN', () => {
    expectParity(NaN, NaN)
    expect(() => expectParity(0, NaN)).toThrow()
    expect(() => expectParity(NaN, 0)).toThrow()
  })

  it('matches infinities exactly', () => {
    expectParity(Infinity, Infinity)
    expectParity(-Infinity, -Infinity)
    for (const [actual, expected] of [[Infinity, -Infinity], [Infinity, 1], [1, Infinity], [NaN, Infinity]]) {
      expect(() => expectParity(actual, expected)).toThrow()
    }
  })

  it('compares primitive types and nested shapes exactly', () => {
    expectParity({ a: [null, true, 'value', { n: 1 }] }, { a: [null, true, 'value', { n: 1 }] })
    expectParity({ b: 2, a: 1 }, { a: 1, b: 2 })
    for (const [actual, expected] of [[false, true], ['1', 1], [1, '1'], [null, {}], [[], {}]]) {
      expect(() => expectParity(actual, expected)).toThrow()
    }
  })

  it('rejects missing and extra object keys, even for undefined values', () => {
    expect(() => expectParity({ a: 1 }, { a: 1, b: undefined })).toThrow()
    expect(() => expectParity({ a: 1, b: undefined }, { a: 1 })).toThrow()
  })

  it('rejects unequal array lengths and object substitutes', () => {
    expect(() => expectParity([1], [1, 2])).toThrow()
    expect(() => expectParity([1, 2], [1])).toThrow()
    expect(() => expectParity({ 0: 1, length: 1 }, [1])).toThrow()
  })
})

describe('decode', () => {
  it('recursively decodes all non-finite sentinels', () => {
    const decoded = decode({ args: [{ $num: 'inf' }, [{ $num: '-inf' }, { nested: { $num: 'nan' } }]] })
    expect(decoded.args[0]).toBe(Infinity)
    expect(decoded.args[1][0]).toBe(-Infinity)
    expect(decoded.args[1][1].nested).toBeNaN()
  })

  it('preserves ordinary values and objects that are not exact sentinels', () => {
    const input = { a: [null, true, 'x', 2], b: { $num: 'other' }, c: { $num: 'inf', extra: true } }
    expect(decode(input)).toEqual(input)
    expect(decode(input)).not.toBe(input)
  })
})

import { expect, test } from 'vitest'
import { formatCI, formatCount, formatCurrency, formatMetric, formatNumber, formatPercent, formatProbability } from '../../../src/admin/results/format.js'

test('intervals retain both signs and enough precision near zero', () => {
  expect(formatCI([-0.021, 0.054])).toBe('−2.1% to +5.4%')
  expect(formatCI([-0.0004, 0.0004])).toBe('−0.04% to +0.04%')
  for (const value of [0.0000001, 1e-25, Number.MIN_VALUE]) {
    expect(formatPercent(-value, true)).toMatch(/^−/)
    expect(formatPercent(value, true)).toMatch(/^\+/)
    expect(formatPercent(-value, true)).not.toMatch(/^−0(?:\.0+)?%$/)
  }
})
test('null bounds are open intervals', () => {
  expect(formatCI([0.021, null])).toBe('at least +2.1%')
  expect(formatCI([null, -0.0004])).toBe('at most −0.04%')
  expect(formatCI([null, null])).toBe('—')
  expect(formatCI([0, null])).toBe('at least 0.0%')
})
test('Intl formats counts, money and metric kinds', () => {
  expect(formatCount(12345)).toBe('12,345')
  expect(formatMetric(12.5, 'revenue')).toBe('$12.50')
  expect(formatMetric(12.5, 'revenue', 'EUR')).toBe('€12.50')
  expect(formatMetric(12.5, 'count')).toBe('12.5')
  expect(formatMetric(0.125, 'binomial')).toBe('12.5%')
  expect(formatProbability(0.00000123)).toBe('0.00000123')
})
test.each([NaN, Infinity, -Infinity, undefined, null])('invalid values (%s) display a dash', value => {
  for (const format of [formatCount, formatNumber, formatPercent, formatCurrency, formatProbability]) expect(format(value)).toBe('—')
  for (const kind of ['revenue', 'binomial', 'count'] as const) expect(formatMetric(value, kind)).toBe('—')
})
test('invalid interval values do not leak NaN or infinity', () => {
  expect(formatCI([NaN, 1])).toBe('—')
  expect(formatCI([0, Infinity])).toBe('—')
  expect(formatCI(undefined)).toBe('—')
})

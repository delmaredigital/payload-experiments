import { describe, expect, it } from 'vitest'
import { findMdeFrequentist, powerEstBayesian, powerEstFrequentist, powerFrequentist, powerMetricWeeks } from '../../src/power/preExperiment.js'
import type { PowerMetricParams, PowerWeeksInput } from '../../src/types.js'

const metrics: PowerMetricParams[] = [
  { type: 'binomial', conversionRate: 0.1, effectSize: 0.05 },
  { type: 'mean', mean: 100, standardDeviation: 30, effectSize: 0.05 },
]
const sizes = [500, 5000, 100000]

function bounded(power: number): void {
  expect(power).toBeGreaterThanOrEqual(0)
  expect(power).toBeLessThanOrEqual(1)
}
function nondecreasing(values: number[]): void {
  values.forEach((value, i) => {
    bounded(value)
    if (i) expect(value).toBeGreaterThanOrEqual(values[i - 1]! - 1e-15)
  })
}

describe.each(metrics)('$type power identities', metric => {
  for (const sequential of [false, 5000] as const) {
    it(`increases with n (sequential=${sequential})`, () => {
      nondecreasing(sizes.map(n => powerEstFrequentist(metric, n, 2, 0.05, true, sequential)))
    })
    for (const sign of [-1, 1]) {
      it(`increases with absolute effect for sign ${sign} (sequential=${sequential})`, () => {
        nondecreasing([0, 0.01, 0.05, 0.2].map(effect => powerEstFrequentist({ ...metric, effectSize: sign * effect }, 5000, 3, 0.05, true, sequential)))
      })
    }
  }

  it('fixed two-tailed power at zero effect equals alpha', () => {
    for (const alpha of [0.05, 0.1]) {
      for (const n of sizes) {
        expect(Math.abs(powerEstFrequentist({ ...metric, effectSize: 0 }, n, 4, alpha, true, false) - alpha)).toBeLessThanOrEqual(1e-12)
        expect(Math.abs(powerFrequentist(0, 0.1, alpha, true) - alpha)).toBeLessThanOrEqual(1e-12)
      }
    }
  })

  it('fixed frequentist MDE approximately inverts 80% power', () => {
    for (const n of sizes) {
      const result = findMdeFrequentist(metric, 0.8, n, 2, 0.05, false)
      expect(result.type).toBe('success')
      if (result.type !== 'success') throw new Error(result.description)
      const power = powerEstFrequentist({ ...metric, effectSize: result.mde }, n, 2, 0.05, true, false)
      expect(Math.abs(power - 0.8)).toBeLessThanOrEqual(1e-3)
    }
  })

  it('Bayesian power stays bounded with absent, proper and improper priors', () => {
    for (const prior of [undefined, { mean: 0.02, variance: 0.04, proper: true }, { mean: -0.05, variance: 0.09, proper: false }]) {
      for (const relative of [true, false]) {
        for (const n of sizes) bounded(powerEstBayesian({ ...metric, prior }, 0.05, n, relative))
      }
    }
  })
})

it('returns both upstream frequentist MDE error shapes', () => {
  for (const power of [0.01, 0.05]) {
    expect(findMdeFrequentist(metrics[0]!, power, 5000, 2, 0.05, false)).toEqual({
      type: 'error', description: 'power must be greater than alpha.',
    })
  }
  for (const sequential of [false, 5000] as const) {
    expect(findMdeFrequentist({ type: 'binomial', conversionRate: 0.0001, effectSize: 0.05 }, 0.8, 500, 4, 0.1, sequential)).toEqual({
      type: 'error', description: 'need to increase number of users or reduce number of variations.',
    })
  }
})

for (const method of [{ type: 'frequentist', sequentialTesting: false }, { type: 'frequentist', sequentialTesting: 5000 }, { type: 'bayesian' }] as const) {
  it(`omits runtime keys for metrics that never reach 80% (${method.type}, ${'sequentialTesting' in method ? method.sequentialTesting : false})`, () => {
    const result = powerMetricWeeks({
      metrics: { conversion: { type: 'binomial', conversionRate: 0.1, effectSize: 0 } },
      nVariations: 2, nWeeks: 4, alpha: 0.05, usersPerWeek: 500, targetPower: 0.9, method,
    })
    expect(result.weeks.every(week => week.metrics.conversion!.power < 0.8)).toBe(true)
    expect('conversion' in result.sampleSizeAndRuntime).toBe(false)
    expect(result.sampleSizeAndRuntime.conversion).toBeUndefined()
  })

  it(`weekly users accumulate linearly (${method.type}, ${'sequentialTesting' in method ? method.sequentialTesting : false})`, () => {
    const input: PowerWeeksInput = {
      metrics: { conversion: metrics[0]!, revenue: metrics[1]! },
      nVariations: 2, nWeeks: 4, alpha: 0.05, usersPerWeek: 5000, targetPower: 0.8, method,
    }
    const result = powerMetricWeeks(input)
    expect(result.weeks).toHaveLength(input.nWeeks)
    result.weeks.forEach((week, i) => {
      expect(week.users).toBe((i + 1) * input.usersPerWeek)
      for (const metric of Object.values(week.metrics)) bounded(metric.power)
    })
  })
}

import { describe, expect, it } from 'vitest'
import { capValues, resolvePercentileCap } from '../../src/capping.js'
import {
  bonferroniAlpha,
  buildRegressionAdjustedStatistic,
  buildStatistic,
  summarizeUnits,
  summarizeUnitsWithCovariate,
} from '../../src/aggregate.js'

// Numerical reference cases live in capping.*.json, registered by parity.test.ts.
// They remain explicitly skipped there until the coordinator's fixture train.
describe('capping identities', () => {
  it('copies values unchanged for a null threshold', () => {
    const values = [-5, 0, 3, 100]
    const result = capValues(values, null)
    expect(result.values).toEqual(values)
    expect(result.values).not.toBe(values)
    expect(result.threshold).toBeNull()
    expect(result.cappedCount).toBe(0)
    expect(result.cappedTotal).toBe(result.uncappedTotal)
  })

  it('does not count a value equal to the threshold as capped', () => {
    expect(capValues([3], 3).cappedCount).toBe(0)
    expect(capValues([3, 4], 3).cappedCount).toBe(1)
  })

  it.each([null, -10, 0, 3, 100])('never increases totals at threshold %s', threshold => {
    const values = [-5, 0, 3, 3, 100]
    const original = [...values]
    const result = capValues(values, threshold)
    expect(result.cappedTotal).toBeLessThanOrEqual(result.uncappedTotal)
    expect(result.threshold).toBe(threshold)
    expect(values).toEqual(original)
  })

  it.each([0.5, 0.9, 0.95, 0.99, 0.999])('returns the singleton at percentile %s', p => {
    for (const value of [-25, 0, 12.5]) {
      expect(resolvePercentileCap([value], p)).toBe(value)
    }
  })

  it('stays within the input bounds, rises with p and preserves the input', () => {
    const values = [90, -20, 10, 10, 0, 100, 30]
    const original = [...values]
    let previous = Math.min(...values)
    for (const p of [0.01, 0.5, 0.9, 0.95, 0.99, 0.999]) {
      const cap = resolvePercentileCap(values, p)!
      expect(cap).toBeGreaterThanOrEqual(Math.min(...values))
      expect(cap).toBeLessThanOrEqual(Math.max(...values))
      expect(cap).toBeGreaterThanOrEqual(previous)
      previous = cap
    }
    expect(values).toEqual(original)
  })

  it('returns null on empty input', () => {
    expect(resolvePercentileCap([], 0.99)).toBeNull()
  })

  it.each([0, 1, -0.1, 1.1, NaN, Infinity])('rejects invalid percentile %s even on empty input', p => {
    expect(() => resolvePercentileCap([], p)).toThrow(RangeError)
  })

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite value %s', value => {
    expect(() => resolvePercentileCap([0, value], 0.99)).toThrow(RangeError)
  })
})

describe('aggregation and builder identities', () => {
  it('returns zero moments for empty input', () => {
    expect(summarizeUnits([])).toEqual({ n: 0, sum: 0, sumSquares: 0 })
  })

  it('preserves post moments when adding covariates and products when swapping them', () => {
    const values = [-3, 0, 4, 100]
    const covariates = [2, -5, 0, 30]
    const joint = summarizeUnitsWithCovariate(values, covariates)
    const swapped = summarizeUnitsWithCovariate(covariates, values)
    expect({ n: joint.n, sum: joint.sum, sumSquares: joint.sumSquares }).toEqual(summarizeUnits(values))
    expect({ n: joint.n, sum: joint.preSum, sumSquares: joint.preSumSquares }).toEqual(summarizeUnits(covariates))
    expect(joint.postPreSumOfProducts).toBe(swapped.postPreSumOfProducts)
  })

  it.each([
    [[1], []],
    [[], [1]],
  ])('rejects mismatched covariate lengths (%j, %j)', (values, covariates) => {
    expect(() => summarizeUnitsWithCovariate(values, covariates)).toThrow(RangeError)
  })

  it.each([
    { n: 3, sum: 2, sumSquares: 4 },
    { n: 1, sum: 2, sumSquares: 2 },
  ])('rejects invalid binomial moments %j in either regression input', moments => {
    expect(() => buildStatistic('binomial', moments)).toThrow(RangeError)
    const valid = { n: moments.n, sum: 1, sumSquares: 1 }
    const validPre = { preSum: 1, preSumSquares: 1, postPreSumOfProducts: 1 }
    expect(() => buildRegressionAdjustedStatistic('binomial', { ...moments, ...validPre })).toThrow(RangeError)
    expect(() => buildRegressionAdjustedStatistic('binomial', {
      ...valid,
      preSum: moments.sum,
      preSumSquares: moments.sumSquares,
      postPreSumOfProducts: 1,
    })).toThrow(RangeError)
  })

  it.each(['binomial', 'count', 'revenue'] as const)('builds matching inner types and null theta for %s', kind => {
    const moments = summarizeUnitsWithCovariate([0, 1, 1, 0], [1, 0, 1, 0])
    const result = buildRegressionAdjustedStatistic(kind, moments)
    expect(result.type).toBe('regressionAdjusted')
    expect(result.n).toBe(moments.n)
    expect(result.theta).toBeNull()
    expect(result.postPreSumOfProducts).toBe(moments.postPreSumOfProducts)
    expect(result.post).toEqual(buildStatistic(kind, moments))
    expect(result.pre).toEqual(buildStatistic(kind, {
      n: moments.n, sum: moments.preSum, sumSquares: moments.preSumSquares,
    }))
    expect(result.post.type).toBe(kind === 'binomial' ? 'proportion' : 'sampleMean')
    expect(result.pre.type).toBe(result.post.type)
  })
})

describe('Bonferroni identities', () => {
  it.each([0.01, 0.05, 0.1, 0.5])('preserves alpha %s for one comparison', alpha => {
    expect(bonferroniAlpha(alpha, 1)).toBe(alpha)
  })

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid comparison count %s', k => {
    expect(() => bonferroniAlpha(0.05, k)).toThrow(RangeError)
  })

  it.each([0, 1, NaN, Infinity])('rejects invalid alpha %s', alpha => {
    expect(() => bonferroniAlpha(alpha, 2)).toThrow(RangeError)
  })
})

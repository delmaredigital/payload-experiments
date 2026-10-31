import { describe, expect, it } from 'vitest'
import {
  computeCovariance, computeTheta, createThetaAdjustedStatistics,
  statisticMean, statisticUnadjustedMean, statisticVariance, statisticStddev,
} from '../../src/statistics.js'
import { abTestMoments } from '../../src/effectMoments.js'
import {
  twoSidedTTest, oneSidedTreatmentGreaterTTest, oneSidedTreatmentLesserTTest,
} from '../../src/reference/fixedHorizon.js'
import { frequentistDiff, frequentistVariance, gaussianCredibleInterval, varianceOfRatios } from '../../src/internal/utils.js'
import { ZERO_NEGATIVE_BASELINE_VARIATION, ZERO_NEGATIVE_VARIANCE } from '../../src/internal/messages.js'
import type { BaseStatistic, RegressionAdjustedStatistic, SampleMeanStatistic } from '../../src/types.js'

// Identities only. Numeric expectations belong to the pinned upstream fixtures
// loaded (and skipped while pending) by tests/parity/parity.test.ts.
const a: SampleMeanStatistic = { type: 'sampleMean', n: 1000, sum: 2000, sumSquares: 6000 }
const b: SampleMeanStatistic = { type: 'sampleMean', n: 1300, sum: 2860, sumSquares: 9000 }
const preA: SampleMeanStatistic = { type: 'sampleMean', n: a.n, sum: 1000, sumSquares: 2000 }
const preB: SampleMeanStatistic = { type: 'sampleMean', n: b.n, sum: 1430, sumSquares: 3120 }
const ra = (post: BaseStatistic, pre: BaseStatistic, products: number, theta: number | null = null): RegressionAdjustedStatistic => ({
  type: 'regressionAdjusted', n: post.n, post, pre, postPreSumOfProducts: products, theta,
})
const raA = ra(a, preA, 2500)
const raB = ra(b, preB, 3770)

function checkInterval(result: ReturnType<typeof twoSidedTTest>): void {
  expect(result.errorMessage).toBeNull()
  expect(result.ci[0]).toBeLessThanOrEqual(result.expected)
  expect(result.ci[1]).toBeGreaterThanOrEqual(result.expected)
}

describe('statistics identities', () => {
  it('negates the absolute point estimate when arms swap, including CUPED', () => {
    for (const [x, y] of [[a, b], [raA, raB]] as const) {
      const forward = abTestMoments(x, y, 'absolute')
      const reverse = abTestMoments(y, x, 'absolute')
      expect(forward.errorMessage).toBeNull()
      expect(reverse.errorMessage).toBeNull()
      expect(forward.pointEstimate).toBe(-reverse.pointEstimate)
      expect(forward.standardError).toBe(reverse.standardError)
    }
  })

  it('has nonnegative variance on valid sample-mean, proportion and adjusted moments', () => {
    const [adjustedA, adjustedB] = createThetaAdjustedStatistics(raA, raB)
    for (const stat of [a, b, { type: 'proportion', n: 100, sum: 40 } as const, adjustedA, adjustedB]) {
      expect(statisticVariance(stat)).toBeGreaterThanOrEqual(0)
      expect(statisticStddev(stat) ** 2).toBeCloseTo(statisticVariance(stat), 12)
    }
  })

  it('keeps explicit theta zero RA objects and their post moments unchanged', () => {
    const x = ra(a, preA, 2500, 0)
    const y = ra(b, preB, 3770, 0)
    const pair = createThetaAdjustedStatistics(x, y)
    expect(pair[0]).toBe(x)
    expect(pair[1]).toBe(y)
    expect(statisticMean(x)).toBe(statisticMean(a))
    expect(statisticUnadjustedMean(x)).toBe(statisticMean(a))
    expect(statisticVariance(x)).toBe(statisticVariance(a))
  })

  it('reverts an inferred zero theta to the same post objects', () => {
    const zeroPreA = { ...preA, sum: 0, sumSquares: 0 }
    const zeroPreB = { ...preB, sum: 0, sumSquares: 0 }
    const x = ra(a, zeroPreA, 0)
    const y = ra(b, zeroPreB, 0)
    expect(computeTheta(x, y)).toBe(0)
    const pair = createThetaAdjustedStatistics(x, y)
    expect(pair[0]).toBe(a)
    expect(pair[1]).toBe(b)
    expect(abTestMoments(x, y)).toEqual(abTestMoments(a, b))
    // Nonzero pre variance, zero pooled covariance exercises the other revert.
    const independent = ra({ type: 'sampleMean', n: 2, sum: 2, sumSquares: 4 },
      { type: 'sampleMean', n: 2, sum: 2, sumSquares: 4 }, 2)
    expect(computeTheta(independent, independent)).toBe(0)
    expect(createThetaAdjustedStatistics(independent, independent)[0]).toBe(independent.post)
  })

  it('returns immutable adjusted copies and leaves the caller theta untouched', () => {
    const x = Object.freeze({ ...raA })
    const y = Object.freeze({ ...raB, theta: 0 })
    const [adjustedA, adjustedB] = createThetaAdjustedStatistics(x, y)
    expect(x.theta).toBeNull()
    expect(y.theta).toBe(0)
    expect(adjustedA).not.toBe(x)
    expect(adjustedB).not.toBe(y)
    expect(adjustedA.type).toBe('regressionAdjusted')
    expect(adjustedB.type).toBe('regressionAdjusted')
    if (adjustedA.type === 'regressionAdjusted' && adjustedB.type === 'regressionAdjusted') {
      expect(adjustedA.theta).toBe(adjustedB.theta)
      expect(adjustedA.theta).toBe(computeTheta(x, y))
    }
  })

  it('retains the proportion vs sample covariance denominator identity', () => {
    const p = { type: 'proportion', n: 100, sum: 40 } as const
    const q = { type: 'proportion', n: 100, sum: 50 } as const
    const meanP = { ...p, type: 'sampleMean', sumSquares: p.sum } as const
    const meanQ = { ...q, type: 'sampleMean', sumSquares: q.sum } as const
    expect(computeCovariance(100, p, q, 30) * 100 / 99).toBeCloseTo(computeCovariance(100, meanP, meanQ, 30), 15)
    for (const n of [0, 1]) {
      expect(computeCovariance(n, p, q, 30)).toBe(0)
      expect(statisticVariance({ ...a, n })).toBe(0)
      expect(statisticVariance({ ...raA, n })).toBe(0)
    }
    expect(statisticMean({ ...a, n: 0 })).toBe(0)
    expect(statisticStddev({ ...a, sumSquares: 0 })).toBe(0)
  })

  it('rejects mismatched RA pre/post types before early exits', () => {
    const invalid = ra(a, { type: 'proportion', n: a.n, sum: 400 }, 500)
    for (const n of [0, 1, a.n]) {
      const x = { ...invalid, n }
      expect(() => statisticVariance(x)).toThrow(TypeError)
      expect(() => computeTheta(x, raB)).toThrow(TypeError)
      expect(() => computeTheta(raA, x)).toThrow(TypeError)
      expect(() => createThetaAdjustedStatistics(x, b)).toThrow(TypeError)
      expect(() => createThetaAdjustedStatistics(a, x)).toThrow(TypeError)
      expect(() => abTestMoments(x, b)).toThrow(TypeError)
      expect(() => abTestMoments(a, x)).toThrow(TypeError)
    }
  })

  it('preserves the error precedence for variance, both baseline checks and mixed RA', () => {
    const zero = { ...a, sum: 0, sumSquares: 0 }
    const zeroAdjusted = ra(a, a, a.sum ** 2 / a.n, 1)
    const zeroUnadjusted = ra({ ...a, sum: 0 }, preA, 0, 0.5)
    expect(abTestMoments(ra(zero, preA, 0, 0), b).errorMessage).toBe(ZERO_NEGATIVE_VARIANCE)
    expect(abTestMoments(zeroAdjusted, b, 'absolute').errorMessage).toBe(ZERO_NEGATIVE_BASELINE_VARIATION)
    expect(abTestMoments(zeroUnadjusted, b, 'absolute').errorMessage).toBe(ZERO_NEGATIVE_BASELINE_VARIATION)
    expect(abTestMoments({ ...raA, theta: 0 }, b).errorMessage).toContain('stat_a')
    expect(abTestMoments(a, { ...raB, theta: 0 }).errorMessage).toContain('stat_b')
  })
})

describe('fixed-horizon identities', () => {
  it('contains expected and widens as alpha falls, with and without CUPED', () => {
    for (const [x, y] of [[a, b], [raA, raB]] as const) {
      for (const differenceType of ['relative', 'absolute'] as const) {
        const wide = twoSidedTTest(x, y, { alpha: 0.01, differenceType })
        const narrow = twoSidedTTest(x, y, { alpha: 0.1, differenceType })
        checkInterval(wide)
        checkInterval(narrow)
        expect(wide.ci[0]).toBeLessThan(narrow.ci[0]!)
        expect(wide.ci[1]).toBeGreaterThan(narrow.ci[1]!)
      }
    }
  })

  it('returns zero expected and two-sided pValue one for identical arms', () => {
    for (const stat of [a, raA]) {
      const result = twoSidedTTest(stat, stat)
      expect(result.errorMessage).toBeNull()
      expect(result.expected).toBe(0)
      expect(result.pValue).toBe(1)
    }
  })

  it('keeps one-sided open ends at infinity and complementary p-values', () => {
    const greater = oneSidedTreatmentGreaterTTest(a, b)
    const lesser = oneSidedTreatmentLesserTTest(a, b)
    checkInterval(greater)
    checkInterval(lesser)
    expect(greater.ci[1]).toBe(Infinity)
    expect(lesser.ci[0]).toBe(-Infinity)
    expect(greater.pValue! + lesser.pValue!).toBeCloseTo(1, 15)
  })

  it('changes pValue for testValue without shifting the confidence interval', () => {
    for (const test of [twoSidedTTest, oneSidedTreatmentGreaterTTest, oneSidedTreatmentLesserTTest]) {
      const ordinary = test(a, b)
      const shifted = test(a, b, { testValue: 0.1 })
      expect(ordinary.ci).toEqual(shifted.ci)
      expect(ordinary.expected).toBe(shifted.expected)
      expect(ordinary.pValue).not.toBe(shifted.pValue)
    }
  })

  it('passes the moments error through to the default output', () => {
    const invalidVariance = { ...a, sumSquares: 0 }
    for (const test of [twoSidedTTest, oneSidedTreatmentGreaterTTest, oneSidedTreatmentLesserTTest]) {
      const result = test(invalidVariance, b)
      expect(result.errorMessage).toBe(abTestMoments(invalidVariance, b).errorMessage)
      expect(result.expected).toBe(0)
      expect(result.ci).toEqual([0, 0])
      expect(result.pValue).toBe(1)
      expect(result.uplift.mean).toBe(0)
      expect(result.uplift.stddev).toBe(0)
      expect(result.pValueErrorMessage).toBeNull()
    }
  })
})

describe('utils identities', () => {
  it('uses the falsy unadjusted-mean fallback and absolute negative baseline', () => {
    expect(frequentistDiff(2, 3, true, 0)).toBe(frequentistDiff(2, 3, true))
    expect(frequentistDiff(-2, -1, true)).toBe(frequentistDiff(2, 3, true))
    expect(frequentistDiff(2, 3, false)).toBe(-frequentistDiff(3, 2, false))
  })

  it('guards the zero ratio denominator and agrees with frequentist variance', () => {
    expect(varianceOfRatios(2, 3, 0, 4, 1)).toBe(0)
    expect(frequentistVariance(2, 3, 100, 4, 5, 200, true)).toBe(varianceOfRatios(5, 4 / 200, 3, 2 / 100, 0))
  })

  it('gives symmetric Gaussian bounds that widen as alpha falls', () => {
    const wide = gaussianCredibleInterval(2, 3, 0.01)
    const narrow = gaussianCredibleInterval(2, 3, 0.1)
    expect(wide[0] + wide[1]).toBeCloseTo(4, 12)
    expect(wide[0]).toBeLessThan(narrow[0])
    expect(wide[1]).toBeGreaterThan(narrow[1])
  })
})

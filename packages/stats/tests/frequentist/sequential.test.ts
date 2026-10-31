import { describe, expect, it } from 'vitest'
import {
  isStatisticallySignificant, sequentialIntervalHalfwidth, sequentialIntervalHalfwidthOneSided,
  sequentialOneSidedTreatmentGreaterTTest, sequentialOneSidedTreatmentLesserTTest,
  sequentialRho, sequentialTwoSidedTTest,
} from '../../src/frequentist/sequential.js'
import { twoSidedTTest } from '../../src/reference/fixedHorizon.js'
import { abTestMoments } from '../../src/effectMoments.js'
import type { RegressionAdjustedStatistic, SampleMeanStatistic } from '../../src/types.js'

const a: SampleMeanStatistic = { type: 'sampleMean', n: 1000, sum: 2000, sumSquares: 6000 }
const b: SampleMeanStatistic = { type: 'sampleMean', n: 1300, sum: 2860, sumSquares: 9000 }
const raA: RegressionAdjustedStatistic = {
  type: 'regressionAdjusted', n: a.n, post: a,
  pre: { type: 'sampleMean', n: a.n, sum: 1000, sumSquares: 2000 }, postPreSumOfProducts: 2500, theta: null,
}
const raB: RegressionAdjustedStatistic = {
  type: 'regressionAdjusted', n: b.n, post: b,
  pre: { type: 'sampleMean', n: b.n, sum: 1430, sumSquares: 3120 }, postPreSumOfProducts: 3770, theta: null,
}
const oneSided = [sequentialOneSidedTreatmentGreaterTTest, sequentialOneSidedTreatmentLesserTTest]
const allTests = [sequentialTwoSidedTTest, ...oneSided]
const pairs = [[a, b], [raA, raB], [
  { type: 'proportion', n: 1000, sum: 200 }, { type: 'proportion', n: 1300, sum: 290 },
]] as const

describe('sequential identities', () => {
  it('has a strictly wider CI than the fixed two-sided reference at n >= 100 per arm', () => {
    for (const [x, y] of pairs) {
      for (const differenceType of ['relative', 'absolute'] as const) {
        const fixed = twoSidedTTest(x, y, { differenceType })
        const sequential = sequentialTwoSidedTTest(x, y, { differenceType })
        expect(fixed.errorMessage).toBeNull()
        expect(sequential.errorMessage).toBeNull()
        expect(sequential.expected).toBe(fixed.expected)
        expect(sequential.uplift).toEqual(fixed.uplift)
        expect(sequential.ci[0]).toBeLessThan(fixed.ci[0]!)
        expect(sequential.ci[1]).toBeGreaterThan(fixed.ci[1]!)
      }
    }
  })

  it('keeps two-sided p in [0, 1] and one-sided diagnostics clamped or null', () => {
    for (const [x, y] of pairs) {
      for (const test of allTests) {
        for (const testValue of [0, 0.1, 1]) {
          const result = test(x, y, { testValue })
          expect(result.errorMessage).toBeNull()
          if (test === sequentialTwoSidedTTest) {
            expect(result.pValue).toBeGreaterThanOrEqual(0)
            expect(result.pValue).toBeLessThanOrEqual(1)
          } else if (result.pValue !== null) {
            expect(result.pValue).toBeGreaterThanOrEqual(1e-5)
            expect(result.pValue).toBeLessThanOrEqual(0.4999)
          } else {
            expect(result.pValueErrorMessage).toBe('NUMERICAL_PVALUE_NOT_CONVERGED')
          }
        }
      }
    }
  })

  it('returns the documented default output for one-sided alpha >= 0.5', () => {
    for (const test of oneSided) {
      for (const alpha of [0.5, 0.8]) {
        const result = test(a, b, { alpha })
        expect(result).toEqual({
          expected: 0, ci: [0, 0], pValue: 1, uplift: { dist: 'normal', mean: 0, stddev: 0 },
          errorMessage: null, pValueErrorMessage: 'ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST',
        })
      }
    }
  })

  it('passes moments errors through before the alpha guard', () => {
    const bad = { ...a, sumSquares: 0 }
    for (const test of allTests) {
      const result = test(bad, b, { alpha: 0.5 })
      expect(result.errorMessage).toBe(abTestMoments(bad, b).errorMessage)
      expect(result.errorMessage).not.toBeNull()
      expect(result.ci).toEqual([0, 0])
      expect(result.expected).toBe(0)
      expect(result.pValue).toBe(1)
      expect(result.uplift).toEqual({ dist: 'normal', mean: 0, stddev: 0 })
      expect(result.pValueErrorMessage).toBeNull()
    }
  })

  it('keeps the open one-sided CI ends at numeric infinities', () => {
    for (const [x, y] of pairs) {
      const greater = sequentialOneSidedTreatmentGreaterTTest(x, y)
      const lesser = sequentialOneSidedTreatmentLesserTTest(x, y)
      expect(greater.ci[1]).toBe(Infinity)
      expect(lesser.ci[0]).toBe(-Infinity)
      expect(greater.expected - greater.ci[0]!).toBeCloseTo(lesser.ci[1]! - lesser.expected, 14)
    }
  })

  it('changes the two-sided p with testValue, leaving every CI and one-sided p unchanged', () => {
    for (const test of allTests) {
      const ordinary = test(a, b)
      const shifted = test(a, b, { testValue: ordinary.expected })
      expect(shifted.ci).toEqual(ordinary.ci)
      expect(shifted.expected).toBe(ordinary.expected)
      if (test === sequentialTwoSidedTTest) {
        expect(shifted.pValue).not.toBe(ordinary.pValue)
        expect(shifted.pValue).toBe(1)
      } else {
        expect(shifted.pValue).toBe(ordinary.pValue)
        expect(shifted.pValueErrorMessage).toBe(ordinary.pValueErrorMessage)
      }
    }
  })

  it('widens eq 9 at n=2000 when tuning rises from 5000 to 1e6', () => {
    // Eq 9 is not globally monotone in tuning. In this range rho falls enough
    // that the 1/(n*rho)^2 term dominates: a later tuning horizon widens the CI.
    expect(sequentialIntervalHalfwidth(2, 2000, 1e6, 0.05))
      .toBeGreaterThan(sequentialIntervalHalfwidth(2, 2000, 5000, 0.05))
  })

  it('uses the matching rho by default and leaves explicit rho independent of tuning', () => {
    for (const [halfwidth, twoSided] of [
      [sequentialIntervalHalfwidth, true], [sequentialIntervalHalfwidthOneSided, false],
    ] as const) {
      const rho = sequentialRho(0.05, 5000, twoSided)
      expect(halfwidth(2, 2000, 5000, 0.05)).toBe(halfwidth(2, 2000, 5000, 0.05, rho))
      expect(halfwidth(2, 2000, 100, 0.05, rho)).toBe(halfwidth(2, 2000, 1e6, 0.05, rho))
    }
    expect(sequentialRho(0.05, 5000)).toBe(sequentialRho(0.05, 5000, true))
    expect(sequentialRho(0.05, 5000, false)).toBe(sequentialRho(0.1, 5000, true))
  })

  it('has zero two-sided p after exp overflow on large n', () => {
    const x: SampleMeanStatistic = { type: 'sampleMean', n: 1e7, sum: 2e7, sumSquares: 6e7 }
    const y: SampleMeanStatistic = { type: 'sampleMean', n: 1e7, sum: 2.2e7, sumSquares: 7e7 }
    const result = sequentialTwoSidedTTest(x, y)
    expect(result.errorMessage).toBeNull()
    expect(result.pValue).toBe(0)
  })

  it('uses strict significance bounds and handles nullable sides independently', () => {
    expect(isStatisticallySignificant([0, Infinity])).toBe(false)
    expect(isStatisticallySignificant([-Infinity, 0])).toBe(false)
    expect(isStatisticallySignificant([-Infinity, Infinity])).toBe(false)
    expect(isStatisticallySignificant([1, Infinity])).toBe(true)
    expect(isStatisticallySignificant([-Infinity, -1])).toBe(true)
    expect(isStatisticallySignificant([null, null])).toBe(false)
    expect(isStatisticallySignificant([null, 1])).toBe(false)
    expect(isStatisticallySignificant([-1, null])).toBe(false)
    expect(isStatisticallySignificant([null, -1])).toBe(true)
    expect(isStatisticallySignificant([1, null])).toBe(true)
  })
})

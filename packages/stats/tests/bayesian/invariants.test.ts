import { describe, expect, it } from 'vitest'
import { effectBayesianABTest } from '../../src/bayesian.js'
import { truncatedNormalMean } from '../../src/internal/truncatedNormal.js'
import { frequentistDiff, gaussianCredibleInterval } from '../../src/internal/utils.js'
import type { BaseStatistic, RegressionAdjustedStatistic } from '../../src/types.js'

const a = { type: 'sampleMean', n: 1000, sum: 2000, sumSquares: 6000 } as const
const b = { type: 'sampleMean', n: 1200, sum: 2640, sumSquares: 8200 } as const
function ra(post: BaseStatistic, pre: BaseStatistic, products: number): RegressionAdjustedStatistic {
  return { type: 'regressionAdjusted', n: post.n, post, pre, postPreSumOfProducts: products, theta: null }
}
const cupedA = ra(a, { ...a, sum: 1000, sumSquares: 1800 }, 2500)
const cupedB = ra(b, { ...b, sum: 1320, sumSquares: 2500 }, 3770)
const pairs = [[a, b], [cupedA, cupedB]] as const

describe('Bayesian identities', () => {
  it('throws for a zero-variance proper prior', () => {
    for (const differenceType of ['absolute', 'relative'] as const) {
      expect(() => effectBayesianABTest(a, b, { differenceType, priorType: 'absolute',
        priorEffect: { mean: 0, variance: 0, proper: true } })).toThrow(RangeError)
    }
  })

  it('complements chance to win and negates absolute expected when arms swap', () => {
    for (const [x, y] of pairs) {
      const forward = effectBayesianABTest(x, y, { differenceType: 'absolute' })
      const reverse = effectBayesianABTest(y, x, { differenceType: 'absolute' })
      expect(forward.errorMessage).toBeNull()
      expect(reverse.errorMessage).toBeNull()
      expect(forward.chanceToWin + reverse.chanceToWin).toBeCloseTo(1, 15)
      expect(forward.expected).toBe(-reverse.expected)
    }
  })

  it('gives identical arms chance to win one half with the improper prior', () => {
    for (const stat of [a, cupedA]) {
      const result = effectBayesianABTest(stat, stat)
      expect(result.errorMessage).toBeNull()
      expect(result.expected).toBe(0)
      expect(result.chanceToWin).toBe(0.5)
    }
  })

  it('shrinks expected toward a proper prior mean', () => {
    for (const [x, y] of pairs) {
      for (const differenceType of ['absolute', 'relative'] as const) {
        const improper = effectBayesianABTest(x, y, { differenceType })
        const prior = { mean: -0.05, variance: 0.01, proper: true }
        const proper = effectBayesianABTest(x, y, { differenceType, priorType: 'absolute', priorEffect: prior })
        expect(proper.errorMessage).toBeNull()
        expect(proper.expected).toBeGreaterThan(prior.mean)
        expect(proper.expected).toBeLessThan(improper.expected)
        expect(Math.abs(proper.expected - prior.mean)).toBeLessThan(Math.abs(improper.expected - prior.mean))
      }
    }
  })

  it('keeps risks nonnegative and reverses them for inverse metrics', () => {
    // The large pair reaches the analytic risk limit; the ordinary pairs use truncation.
    const largeA = { ...a, n: 1e7, sum: 2e7, sumSquares: 6e7 }
    const largeB = { ...b, n: 1e7, sum: 2.2e7, sumSquares: 7e7 }
    for (const [x, y] of [...pairs, [largeA, largeB] as const, [largeB, largeA] as const]) {
      for (const differenceType of ['relative', 'absolute'] as const) {
        const ordinary = effectBayesianABTest(x, y, { differenceType })
        const inverse = effectBayesianABTest(x, y, { differenceType, inverse: true })
        expect(ordinary.errorMessage).toBeNull()
        expect(ordinary.risk[0]).toBeGreaterThanOrEqual(0)
        expect(ordinary.risk[1]).toBeGreaterThanOrEqual(0)
        expect(inverse.risk).toEqual([ordinary.risk[1], ordinary.risk[0]])
        expect(ordinary.chanceToWin + inverse.chanceToWin).toBeCloseTo(1, 15)
        expect(inverse.expected).toBe(ordinary.expected)
        expect(inverse.ci).toEqual(ordinary.ci)
      }
    }
  })
})

describe('truncated normal and utils identities', () => {
  it('keeps one-sided means inside the truncation bounds, including Mills branches', () => {
    for (const mu of [0, -2, 4]) {
      for (const sigma of [0.5, 1, 3]) {
        for (const z of [-37, -20, -10, -3, -1, -0.1, 0, 0.1, 1, 3, 10, 20, 37, 38, 100, 999, 1000, 1e9]) {
          const upperBound = mu + sigma * z
          const lowerBound = mu - sigma * z
          const upper = truncatedNormalMean(mu, sigma, upperBound, Infinity)
          const lower = truncatedNormalMean(mu, sigma, -Infinity, lowerBound)
          expect(Number.isFinite(upper)).toBe(true)
          expect(Number.isFinite(lower)).toBe(true)
          expect(upper).toBeGreaterThanOrEqual(upperBound)
          expect(lower).toBeLessThanOrEqual(lowerBound)
          expect(upper + lower).toBeCloseTo(2 * mu, 12)
        }
      }
    }
  })

  it('returns NaN Gaussian bounds for nonpositive scales', () => {
    for (const scale of [0, -1]) {
      const ci = gaussianCredibleInterval(2, scale, 0.05)
      expect(ci[0]).toBeNaN()
      expect(ci[1]).toBeNaN()
    }
  })

  it('preserves NaN in the Python unadjusted-mean fallback', () => {
    expect(frequentistDiff(2, 3, true, NaN)).toBeNaN()
  })
})

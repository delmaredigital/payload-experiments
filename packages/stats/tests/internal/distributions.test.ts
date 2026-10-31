import { describe, expect, it } from 'vitest'
import { erfc } from '../../src/internal/erf.js'
import { normalCdf, normalPpf, normalSf } from '../../src/internal/normal.js'
import { tCdf, tPpf } from '../../src/internal/studentT.js'
import { chi2Sf } from '../../src/internal/gamma.js'

const probabilities = [1e-300, 1e-200, 1e-100, 1e-50, 1e-16, 1e-12, 1e-10, 1e-5, 0.001, 0.025, 0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 0.95, 0.975, 0.999, 1 - 1e-5, 1 - 1e-10, 1 - 1e-16]
const degrees = [1, 1.5, 2, 2.5, 3, 5, 10.7, 30, 100, 1e4, 10001, 1e6, 1e7]

function relative(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected)
}

// Abramowitz & Stegun 26.7.5, the four finite-dof Cornish–Fisher terms.
function cornishFisher(z: number, n: number): number {
  const g1 = (z ** 3 + z) / 4
  const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96
  const g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384
  const g4 = (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / 92160
  return z + (g1 + (g2 + (g3 + g4 / n) / n) / n) / n
}

describe('normal distribution identities', () => {
  it('has the exact centre and the standard 97.5th percentile', () => {
    expect(normalCdf(0)).toBe(0.5)
    expect(normalSf(0)).toBe(0.5)
    // Standard normal 97.5th percentile, conventionally tabulated as
    // 1.959963984540054 (the two-sided 95% Gaussian confidence limit).
    expect(Math.abs(normalPpf(0.975) - 1.959963984540054)).toBeLessThanOrEqual(1e-15)
  })

  it('round trips both tails without subtracting a rounded cdf from one', () => {
    let worst = 0
    for (const p of probabilities) {
      const x = normalPpf(p)
      const actual = p <= 0.5 ? normalCdf(x) : normalSf(x)
      const expected = p <= 0.5 ? p : 1 - p
      worst = Math.max(worst, relative(actual, expected))
      expect(relative(actual, expected), `p=${p}`).toBeLessThanOrEqual(1e-13)
    }
    console.info(`normal round-trip worst relative error: ${worst}`)
    expect(normalSf(38)).toBeGreaterThan(0)
    expect(normalSf(38)).toBeLessThan(normalSf(37.5))
  })

  it('is symmetric and monotone on the full grid', () => {
    let previous = 0
    for (let i = -380; i <= 380; i++) {
      const x = i / 10
      expect(normalCdf(-x)).toBe(normalSf(x))
      expect(normalCdf(x)).toBeGreaterThanOrEqual(previous)
      previous = normalCdf(x)
    }
    let previousQuantile = -Infinity
    for (const p of probabilities) {
      expect(normalPpf(p)).toBeGreaterThan(previousQuantile)
      previousQuantile = normalPpf(p)
    }
  })

  it('handles endpoints and invalid probabilities', () => {
    expect(normalPpf(0)).toBe(-Infinity)
    expect(normalPpf(1)).toBe(Infinity)
    for (const p of [-1, 2, NaN]) expect(normalPpf(p)).toBeNaN()
    expect(normalCdf(-Infinity)).toBe(0)
    expect(normalSf(Infinity)).toBe(0)
    expect(normalCdf(NaN)).toBeNaN()
    expect(normalSf(NaN)).toBeNaN()
  })
})

describe('Student-t distribution identities', () => {
  it('agrees with Cauchy and the dof=2 closed form', () => {
    let worst = 0
    for (const x of [-50, -10, -3, -1, -0.1, 0, 0.5, 2, 6, 40]) {
      const cauchy = 0.5 + Math.atan(x) / Math.PI
      const second = 0.5 + x / (2 * Math.sqrt(2 + x * x))
      expect(Math.abs(tCdf(x, 1) - cauchy), `Cauchy x=${x}`).toBeLessThanOrEqual(1e-14)
      expect(Math.abs(tCdf(x, 2) - second), `dof=2 x=${x}`).toBeLessThanOrEqual(1e-14)
      // Stable versions of the same identities measure relative tail error.
      if (x > 0) {
        const stable1 = Math.atan(1 / x) / Math.PI
        const h = Math.sqrt(2 + x * x)
        const stable2 = 1 / (h * (h + x))
        worst = Math.max(worst, relative(tCdf(-x, 1), stable1), relative(tCdf(-x, 2), stable2))
      }
    }
    console.info(`t closed-form worst relative error: ${worst}`)
  })

  it('round trips the representable smaller tail across dof and checks symmetry', () => {
    let worst = 0
    for (const n of degrees) {
      let previous = 0
      for (const x of [-50, -10, -3, -1, 0, 0.5, 2, 6, 40]) {
        expect(tCdf(x, n)).toBeGreaterThanOrEqual(previous)
        previous = tCdf(x, n)
        expect(Math.abs(tCdf(x, n) + tCdf(-x, n) - 1)).toBeLessThanOrEqual(Number.EPSILON)
        const p = tCdf(-Math.abs(x), n)
        if (p === 0 || x === 0) continue
        const error = relative(tPpf(p, n), -Math.abs(x))
        worst = Math.max(worst, error)
        expect(error, `x=${x}, n=${n}`).toBeLessThanOrEqual(1e-12)
      }
      for (const p of [1e-12, 1e-6, 0.025, 0.5, 0.975, 1 - 1e-6, 1 - 1e-12]) {
        const q = Math.min(p, 1 - p)
        const error = relative(tCdf(-Math.abs(tPpf(p, n)), n), q)
        expect(error, `p=${p}, n=${n}`).toBeLessThanOrEqual(1e-12)
      }
    }
    console.info(`t quantile round-trip worst relative error: ${worst}`)
  })

  it('retains the four finite-dof Cornish–Fisher corrections', () => {
    let worst = 0
    for (const n of [1e4, 10001, 1e6, 1e7]) {
      for (const p of [1e-12, 1e-6, 0.025, 0.1, 0.9, 0.975, 1 - 1e-6, 1 - 1e-12]) {
        const expected = cornishFisher(normalPpf(p), n)
        const error = relative(tPpf(p, n), expected)
        worst = Math.max(worst, error)
        expect(error, `p=${p}, n=${n}`).toBeLessThanOrEqual(1e-12)
      }
    }
    console.info(`t Cornish–Fisher worst relative error: ${worst}`)
  })

  it('retains finite polynomial-tail quantiles without intermediate underflow', () => {
    for (const n of [1, 1.5, 2, 3]) {
      for (const p of [1e-300, 1e-200, 1e-100]) {
        const x = tPpf(p, n)
        expect(Number.isFinite(x), `p=${p}, n=${n}`).toBe(true)
        expect(relative(tCdf(x, n), p), `p=${p}, n=${n}`).toBeLessThanOrEqual(1e-12)
      }
    }
  })

  it('underflows huge finite-dof tails without overflowing the asymptotic correction', () => {
    for (const n of [1e6, 1e100, 1e308]) {
      for (const x of [1e100, 1e200, 1e308]) {
        expect(tCdf(-x, n)).toBe(0)
        expect(tCdf(x, n)).toBe(1)
      }
    }
  })

  it('handles endpoints, invalid dof, and the infinite-dof normal limit', () => {
    for (const n of [1, 2, 30, 1e7]) {
      expect(tCdf(0, n)).toBe(0.5)
      expect(tCdf(-Infinity, n)).toBe(0)
      expect(tCdf(Infinity, n)).toBe(1)
      expect(tPpf(0, n)).toBe(-Infinity)
      expect(tPpf(1, n)).toBe(Infinity)
      expect(tPpf(0.5, n)).toBe(0)
      for (const p of [-1, 2, NaN]) expect(tPpf(p, n)).toBeNaN()
    }
    for (const n of [-1, 0, NaN]) {
      expect(tCdf(1, n)).toBeNaN()
      expect(tPpf(0.1, n)).toBeNaN()
    }
    for (const x of [-38, -3, 0, 1, 38]) expect(tCdf(x, Infinity)).toBe(normalCdf(x))
    for (const p of probabilities) expect(tPpf(p, Infinity)).toBe(normalPpf(p))
  })
})

describe('chi-square distribution identities', () => {
  it('has the exponential dof=2 survival function, including deep tails', () => {
    let worst = 0
    for (const x of [0, 1e-6, 0.5, 1, 3.84, 10, 50, 200, 600, 1000]) {
      const expected = Math.exp(-x / 2)
      const error = relative(chi2Sf(x, 2), expected)
      worst = Math.max(worst, error)
      expect(error).toBeLessThanOrEqual(1e-14)
    }
    console.info(`chi2 exponential worst relative error: ${worst}`)
  })

  it('agrees with the squared-normal and dof=4 closed forms', () => {
    let worst = 0
    for (const x of [0, 1e-6, 0.5, 1, 3.84, 10, 50, 200, 600, 1000]) {
      const first = erfc(Math.sqrt(x / 2))
      const fourth = Math.exp(-x / 2) * (1 + x / 2)
      for (const [k, expected] of [[1, first], [4, fourth]] as const) {
        const error = relative(chi2Sf(x, k), expected)
        worst = Math.max(worst, error)
        expect(error, `x=${x}, k=${k}`).toBeLessThanOrEqual(1e-13)
      }
    }
    console.info(`chi2 closed-form worst relative error: ${worst}`)
    expect(chi2Sf(1000, 1)).toBeGreaterThan(0)
  })

  it('handles boundaries and invalid degrees of freedom', () => {
    expect(chi2Sf(-1, 2)).toBe(1)
    expect(chi2Sf(0, 2)).toBe(1)
    expect(chi2Sf(Infinity, 2)).toBe(0)
    for (const k of [1, 2, 3, 4]) {
      for (const x of [1e100, 1e200, 1e308]) expect(chi2Sf(x, k)).toBe(0)
    }
    for (const k of [0, -1, NaN]) expect(chi2Sf(1, k)).toBeNaN()
    expect(chi2Sf(NaN, 2)).toBeNaN()
  })
})

import { normalCdf, normalPpf } from './normal.js'

// log B(a, 1/2), evaluated without subtracting two large log-gammas.
// Stirling's gamma-ratio expansion, shifted into its accurate range.
function logBetaHalf(a: number): number {
  let shift = 0
  while (a < 32) {
    shift += Math.log1p(0.5 / a)
    a++
  }
  const r = 1 / a
  const r2 = r * r
  return shift + 0.57236494292470008707 - 0.5 * Math.log(a)
    + r * (1 / 8 + r2 * (-1 / 192 + r2 * (1 / 640 - r2 * 17 / 14336)))
}

// Incomplete beta: power series near zero, otherwise a modified Lentz
// continued fraction, with the Numerical Recipes symmetry swap in tail().
// The caller supplies both logs to retain 1-x near 1.
function betaLower(a: number, b: number, x: number, logX: number, log1mX: number, logBeta: number): number {
  if (b * x <= 1 && x <= 0.95) {
    let term = 1
    let sum = 1 / a
    for (let n = 1; n < 100000; n++) {
      term *= (n - b) * x / n
      const add = term / (a + n)
      sum += add
      if (Math.abs(add) <= Number.EPSILON * Math.abs(sum)) break
    }
    return Math.exp(a * logX - logBeta) * sum
  }
  // Modified Lentz evaluation of the same beta continued fraction.
  const tiny = 1e-300
  const nonzero = (v: number): number => Math.abs(v) < tiny ? tiny : v
  let c = 1
  let d = 1 / nonzero(1 - (a + b) * x / (a + 1))
  let fraction = d
  for (let m = 1; m < 100000; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2))
    d = 1 / nonzero(1 + aa * d)
    c = nonzero(1 + aa / c)
    fraction *= d * c
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1))
    d = 1 / nonzero(1 + aa * d)
    c = nonzero(1 + aa / c)
    const delta = d * c
    fraction *= delta
    if (Math.abs(delta - 1) <= 2 * Number.EPSILON) break
  }
  return Math.exp(a * logX + b * log1mX - logBeta) * fraction / a
}

function logOnePlusSquareRatio(x: number, dof: number): number {
  const logRatio = 2 * Math.log(x) - Math.log(dof)
  return logRatio > 36 ? logRatio + Math.log1p(Math.exp(-logRatio)) : Math.log1p(x * (x / dof))
}

// The positive t upper tail is also the negative t lower tail.
function tail(x: number, dof: number): number {
  if (x === 0) return 0.5
  if (x === Infinity) return 0
  if (dof === 1) return Math.atan2(1, x) / Math.PI
  if (dof > 1e4) {
    // Hill, ACM Algorithm 395: expansion through the 1/dof corrections
    // after the log1p transform. This retains the finite-dof tail correction.
    const a = dof - 0.5
    const b = 48 * a * a
    const y = a * logOnePlusSquareRatio(x, dof)
    // y > 1600 puts the beta-tail exponential below exp(-800),
    // safely below the smallest double. Stop before forming huge powers.
    if (y > 1600) return 0
    const correction = ((((-0.4 * y - 3.3) * y - 24) * y - 85.5)
      / (b + 100 + 0.8 * y * y) + y + 3) / b
    const z = Math.sqrt(y) * (1 + correction)
    return normalCdf(-z)
  }
  const a = dof / 2
  const logV = -logOnePlusSquareRatio(x, dof)
  const logY = 2 * Math.log(x) - Math.log(dof) + logV
  const v = Math.exp(logV)
  const y = Math.exp(logY)
  const logBeta = logBetaHalf(a)
  // Symmetry swap, computed from y itself rather than a rounded 1-v.
  if (v > (a + 1) / (a + 2.5)) {
    return 0.5 * (1 - betaLower(0.5, a, y, logY, logV, logBeta))
  }
  return 0.5 * betaLower(a, 0.5, v, logV, logY, logBeta)
}

/** Source: scipy.stats.t.cdf (fixtures from scipy 1.13.1 in gbstats' pinned environment). */
export function tCdf(x: number, dof: number): number {
  if (!(dof > 0) || Number.isNaN(x)) return NaN
  if (dof === Infinity) return normalCdf(x)
  const small = tail(Math.abs(x), dof)
  return x <= 0 ? small : 1 - small
}

// Small-beta leading term: q ~ (n/x²)^(n/2) / (n B(n/2, 1/2)).
function tailQuantile(q: number, n: number): number {
  return Math.exp((-Math.log(q) - Math.log(n) - logBetaHalf(n / 2)) / n + 0.5 * Math.log(n))
}

// Hill, ACM Algorithm 396, initial approximation (n > 1).
function initialQuantile(q: number, n: number): number {
  if (n === 1) return 1 / Math.tan(Math.PI * q)
  if (n === 2) return (1 - 2 * q) / Math.sqrt(2 * q * (1 - q))
  if (n < 1) return tailQuantile(q, n)
  const a = 1 / (n - 0.5)
  const b = 48 / (a * a)
  let c = ((20700 * a / b - 98) * a - 16) * a + 96.36
  const d = ((94.5 / (b + c) - 3) / b + 1) * Math.sqrt(a * Math.PI / 2) * n
  const logY = 2 / n * (Math.log(d) + Math.log(2 * q))
  // Form x directly when the intermediate inverse-square estimate would
  // underflow (the final quantile can still be a finite double).
  if (logY < -350) return tailQuantile(q, n)
  let y = Math.exp(logY)
  if (y > 0.05 + a) {
    const z = normalPpf(q)
    y = z * z
    if (n < 5) c += 0.3 * (n - 4.5) * (z + 0.6)
    c += (((0.05 * d * z - 5) * z - 7) * z - 2) * z + b
    const w = (((((0.4 * y + 6.3) * y + 36) * y + 94.5) / c - y - 3) / b + 1) * z
    y = Math.expm1(a * w * w)
  } else {
    y = ((1 / (((n + 6) / (n * y) - 0.089 * d - 0.822) * (n + 2) * 3)
      + 0.5 / (n + 4)) * y - 1) * (n + 1) / (n + 2) + 1 / y
  }
  return Math.sqrt(n * y)
}

/** Source: scipy.stats.t.ppf (fixtures from scipy 1.13.1 in gbstats' pinned environment). */
export function tPpf(p: number, dof: number): number {
  if (!(dof > 0) || !(p >= 0 && p <= 1)) return NaN
  if (dof === Infinity) return normalPpf(p)
  if (p === 0) return -Infinity
  if (p === 1) return Infinity
  if (p === 0.5) return 0
  const q = Math.min(p, 1 - p)
  let x = initialQuantile(q, dof)
  if (!Number.isFinite(x)) return p < 0.5 ? -Infinity : Infinity
  let lo = 0
  let hi = Math.max(1, x)
  while (tail(hi, dof) > q) {
    lo = hi
    hi *= 2
    if (hi === Infinity) return p < 0.5 ? -Infinity : Infinity
  }
  x = Math.min(hi, Math.max(lo, x))
  const logNorm = -0.5 * Math.log(dof) - logBetaHalf(dof / 2)
  for (let i = 0; i < 100; i++) {
    const value = tail(x, dof)
    if (value > q) lo = x
    else hi = x
    const density = Math.exp(logNorm - (dof + 1) / 2 * logOnePlusSquareRatio(x, dof))
    const delta = (value - q) / density
    if (Math.abs(delta) <= 1e-15 * Math.abs(x)) break
    const next = x + delta
    const candidate = next > lo && next < hi ? next : lo + (hi - lo) / 2
    if (candidate === x) break
    x = candidate
  }
  return p < 0.5 ? -x : x
}

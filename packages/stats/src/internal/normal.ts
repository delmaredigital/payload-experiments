import { erfc } from './erf.js'

/** Source: scipy.stats.norm.cdf (fixtures from scipy 1.13.1 in gbstats' pinned environment). */
export function normalCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2)
}

/** Source: scipy.stats.norm.sf (fixtures from scipy 1.13.1 in gbstats' pinned environment). */
export function normalSf(x: number): number {
  return 0.5 * erfc(x / Math.SQRT2)
}

// Wichura, AS241 (PPND16), Applied Statistics 37 (1988), coefficients
// in ascending order. The central and two tail ranges retain 16 digits.
const A = [3.3871328727963666080, 133.14166789178437745, 1971.5909503065514427, 13731.693765509461125, 45921.953931549871457, 67265.770927008700853, 33430.575583588128105, 2509.0809287301226727]
const B = [1, 42.313330701600911252, 687.18700749205790830, 5394.1960214247511077, 21213.794301586595867, 39307.895800092710610, 28729.085735721942674, 5226.4952788528545610]
const C = [1.42343711074968357734, 4.63033784615654529590, 5.76949722146069140550, 3.64784832476320460504, 1.27045825245236838258, 0.24178072517745061177, 0.0227238449892691845833, 0.00077454501427834140764]
const D = [1, 2.05319162663775882187, 1.67638483018380384940, 0.68976733498510000455, 0.14810397642748007459, 0.0151986665636164571966, 0.0005475938084995344946, 1.05075007164441684324e-9]
const E = [6.65790464350110377720, 5.46378491116411436990, 1.78482653991729133580, 0.29656057182850489123, 0.026532189526576123093, 0.0012426609473880784386, 0.0000271155556874348757815, 2.01033439929228813265e-7]
const F = [1, 0.59983220655588793769, 0.13692988092273580531, 0.0148753612908506148525, 0.0007868691311456132591, 0.000018463183175100546818, 1.4215117583164458887e-7, 2.04426310338993978564e-15]

function polynomial(coefficients: readonly number[], x: number): number {
  let result = coefficients[coefficients.length - 1]!
  for (let i = coefficients.length - 2; i >= 0; i--) result = result * x + coefficients[i]!
  return result
}

/** Source: scipy.stats.norm.ppf (fixtures from scipy 1.13.1 in gbstats' pinned environment). */
export function normalPpf(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN
  if (p === 0) return -Infinity
  if (p === 1) return Infinity
  const q = p - 0.5
  let x: number
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q
    x = q * polynomial(A, r) / polynomial(B, r)
  } else {
    let r = Math.sqrt(-Math.log(p < 0.5 ? p : 1 - p))
    if (r <= 5) {
      r -= 1.6
      x = polynomial(C, r) / polynomial(D, r)
    } else {
      r -= 5
      x = polynomial(E, r) / polynomial(F, r)
    }
    if (q < 0) x = -x
  }
  const density = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
  // Refine the smaller tail directly; subtracting a cdf from 1 loses it.
  const u = p <= 0.5 ? (normalCdf(x) - p) / density : -(normalSf(x) - (1 - p)) / density
  return x - u / (1 + 0.5 * x * u)
}

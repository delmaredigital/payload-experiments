// Lanczos g=7, followed by the Cephes igam series / igamc continued fraction.
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]

/** Log-gamma for positive arguments using the Lanczos g=7 approximation. */
function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - logGamma(1 - x)
  const z = x - 1
  let sum = LANCZOS[0]!
  for (let i = 1; i < LANCZOS.length; i++) sum += LANCZOS[i]! / (z + i)
  const t = z + 7.5
  return 0.91893853320467274178 + (z + 0.5) * Math.log(t) - t + Math.log(sum)
}

/** Source: scipy.stats.chi2.sf (fixtures from scipy 1.13.1 in gbstats' pinned environment). */
export function chi2Sf(x: number, k: number): number {
  if (!(k > 0) || Number.isNaN(x)) return NaN
  if (x <= 0) return 1
  if (x === Infinity) return 0
  if (k === Infinity) return 1
  const a = k / 2
  const z = x / 2
  if (a === 1) return Math.exp(-z)
  const scale = Math.exp(a * Math.log(z) - z - logGamma(a))
  if (z <= a + 1) {
    let term = 1 / a
    let sum = term
    for (let n = 1; n < 100000; n++) {
      term *= z / (a + n)
      sum += term
      if (term <= sum * Number.EPSILON) break
    }
    return Math.max(0, 1 - scale * sum)
  }
  // In this branch the continued-fraction factor is < 1. Once the
  // exponential scale underflows, the survival probability is also zero.
  if (scale === 0) return 0
  // Cephes' convergents, rescaled before they overflow.
  let y = 1 - a
  let b = z + y + 1
  let p0 = 1
  let q0 = z
  let p1 = z + 1
  let q1 = b * z
  let answer = p1 / q1
  for (let n = 1; n < 100000; n++) {
    y++
    b += 2
    const c = y * n
    const p = p1 * b - p0 * c
    const q = q1 * b - q0 * c
    const next = q !== 0 ? p / q : answer
    const converged = Math.abs(next - answer) <= Number.EPSILON * Math.abs(next)
    answer = next
    p0 = p1
    p1 = p
    q0 = q1
    q1 = q
    if (Math.abs(p1) > 2 ** 52) {
      p0 *= 2 ** -52
      p1 *= 2 ** -52
      q0 *= 2 ** -52
      q1 *= 2 ** -52
    }
    if (converged) break
  }
  return scale * answer
}

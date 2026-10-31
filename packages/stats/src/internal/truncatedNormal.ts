import { erfc } from './erf.js'

/**
 * Source: gbstats/utils.py truncated_normal_mean @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * scipy 1.13.1 one-sided mean for |standardised bound| <= 37, plus upstream's
 * one-sided Mills branches at >= 1e3. Two finite bounds are unused and throw RangeError.
 */
export function truncatedNormalMean(mu: number, sigma: number, a: number, b: number): number {
  if (Number.isFinite(a) && Number.isFinite(b)) throw new RangeError('Two finite truncation bounds are not supported')
  const alpha = (a - mu) / sigma
  const beta = (b - mu) / sigma
  // Preserve upstream's first-order Mills asymptotic, including its operation
  // order; scipy loses precision for extreme standardised truncation bounds.
  if (a === -Infinity && beta <= -1e3) return b + sigma / beta
  if (b === Infinity && alpha >= 1e3) return a + sigma / alpha
  if (!(sigma > 0) || !(alpha < beta)) return NaN
  // The scipy truncnorm mean is mu + sigma*(phi(alpha)-phi(beta)) /
  // (Phi(beta)-Phi(alpha)). With one infinite bound it reduces to +/- M(x),
  // M(x) = phi(x)/Phi_c(x) = sqrt(2/pi)/erfcx(x/sqrt(2)).
  if (b === Infinity) return mu + sigma * millsRatio(alpha)
  if (a === -Infinity) return mu - sigma * millsRatio(-beta)
  return NaN
}

function millsRatio(x: number): number {
  if (x === -Infinity) return 0
  const z = x / Math.SQRT2
  // L2's scaled Cody helper is private. In the required |x| <= 37 domain,
  // exp(z*z) and erfc(z) are both representable, so their product gives erfcx
  // without CDF subtraction or an underflowing normal-density/tail quotient.
  const erfcx = Math.exp(z * z) * erfc(z)
  return Math.sqrt(2 / Math.PI) / erfcx
}

export interface GuardrailInput {
  method: 'sequential' | 'bayesian'
  n: number
  minSampleSize: number
  threshold: number
  direction: 'higher-is-better' | 'inverse'
  /** Raw relative-effect bounds: sequential greater-test lower and lesser-test upper.
   * Bayesian bounds use alpha 0.10; pass raw bounds before direction inversion. */
  lowerBound: number | null
  upperBound: number | null
  pointEstimate: number
  /** Probability of harm, already adjusted for direction. */
  pWorse?: number
}

/** Classify precomputed one-sided results in the order specified by plan CORE-15a. */
export function guardrailStatus(input: GuardrailInput): 'failing' | 'ok' | 'warning' | 'insufficient' {
  const inverse = input.direction === 'inverse'
  const lower = inverse ? (input.upperBound === null ? null : -input.upperBound) : input.lowerBound
  const upper = inverse ? (input.lowerBound === null ? null : -input.lowerBound) : input.upperBound
  const harmful = input.method === 'bayesian' ? (input.pWorse ?? 0) >= 0.95 : upper !== null && upper < 0
  if (input.n >= input.minSampleSize && harmful) return 'failing'
  if (lower !== null && lower > -input.threshold) return 'ok'
  const warning = input.method === 'bayesian'
    ? (input.pWorse ?? 0) >= 0.70
    : (inverse ? -input.pointEstimate : input.pointEstimate) < 0
  return warning ? 'warning' : 'insufficient'
}

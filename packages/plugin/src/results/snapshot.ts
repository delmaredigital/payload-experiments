import { XpAnalysisError } from '../errors.js'
import type { Snapshot } from '../types/snapshot.js'

/** JSON cannot represent unbounded confidence limits. */
export function jsonInterval(ci: readonly [number | null, number | null]): [number | null, number | null] {
  return ci.map(bound => bound !== null && Number.isFinite(bound) ? bound : null) as [number | null, number | null]
}

type Check = (value: unknown) => boolean
const number: Check = value => typeof value === 'number' && Number.isFinite(value)
const count: Check = value => number(value) && Number.isInteger(value) && (value as number) >= 0
const string: Check = value => typeof value === 'string'
const boolean: Check = value => typeof value === 'boolean'
const nullable = (check: Check): Check => value => value === null || check(value)
const union = (...checks: Check[]): Check => value => checks.some(check => check(value))
const list = (check: Check): Check => value => Array.isArray(value) && value.every(check)
const oneOf = (...values: unknown[]): Check => value => values.includes(value)
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const object = (fields: Record<string, Check>, optional: Record<string, Check> = {}): Check => value => isObject(value)
  && Object.entries(fields).every(([key, check]) => check(value[key]))
  && Object.entries(optional).every(([key, check]) => value[key] === undefined || check(value[key]))
const record = (check: Check): Check => value => isObject(value) && Object.values(value).every(check)
const id: Check = value => string(value) || number(value)
const interval: Check = value => Array.isArray(value) && value.length === 2 && value.every(nullable(number))
const timestamp: Check = value => typeof value === 'string' && Number.isFinite(new Date(value).getTime())
const probability: Check = value => number(value) && (value as number) >= 0 && (value as number) <= 1
const status = oneOf('failing', 'ok', 'warning', 'insufficient')
const shape = object({
  experiment: id, phase: count, phaseKind: oneOf('test', 'rollout'), computedAt: timestamp,
  winnerArm: nullable(string), minExposuresPerArm: count,
  window: object({ from: timestamp, to: timestamp }), method: oneOf('sequential', 'bayesian'),
  alpha: probability, alphaAdjusted: probability, k: count,
  params: object({
    sequentialTuningParameter: number, prior: object({ mean: number, variance: number, proper: boolean }), cupedLookbackDays: number,
    caps: record(object({ type: oneOf('percentile', 'absolute'), value: number, resolvedCap: nullable(number) }, { historyUnits: count })),
    attributionWindows: record(number), guardrailThresholds: record(number), minSampleSizes: record(count),
    bayesian: object({ ctw: probability, risk: number }),
  }),
  exposures: object({ total: count, perArm: record(count), excludedMultiArm: count, multiArmShare: probability,
    armMismatch: count, identityConflictShare: probability, capped: record(count) }),
  srm: object({ p: probability, flagged: boolean, expected: record(probability) }),
  metrics: list(object({
    metricId: id, name: string, kind: oneOf('binomial', 'count', 'revenue'), role: oneOf('primary', 'secondary', 'guardrail'), cupedApplied: boolean,
    perArm: list(object({ arm: string, n: count, converters: count, sum: number, sumSquares: number, mean: number, variance: number }, {
      covariate: object({ preSum: number, preSumSquares: number, postPreSumOfProducts: number }),
      capped: object({ resolvedCap: number, uncappedTotal: number, cappedCount: count }),
    })),
    comparisons: list(object({ arm: string, lift: number, ci: interval, ciAdjusted: interval, significant: oneOf('better', 'worse', 'none') }, {
      pValue: probability, pValueAdjusted: probability, chanceToWin: probability, risk: number,
    })),
  }, { unavailable: string })),
  guardrails: list(object({ metricId: id, status })),
  power: object({ daysRemaining: nullable(number), exposuresNeededPerArm: nullable(number), lowerBound: boolean, feasible: boolean }),
  verdict: object({ row: oneOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'R1', 'R2', 'R3'),
    code: oneOf('unavailable', 'data-problem', 'guardrail-failing', 'collecting', 'original-better', 'worse-none-better', 'winner', 'mixed', 'keep-running', 'no-difference', 'rollout-collecting', 'rollout-readout'),
    finding: string, action: nullable(string), headline: string, detail: string, recommendedArm: nullable(string),
  }, { guardrailLine: string }),
  contentChanges: list(object({ at: timestamp, doc: object({ collection: string, id }), by: nullable(id) })),
}, { health: list(union(object({ code: oneOf('version-page-unavailable', 'version-page-unchecked'), path: string }), object({ code: oneOf('goal-in-some-versions'), metricId: id, name: string }))) })

/** Validate the frozen JSON shape and headline/rollout invariants before storage.
 * This also accepts the shared CORE-13/admin fixtures without any I/O.
 */
export function validateSnapshot(value: unknown): asserts value is Snapshot {
  if (!shape(value)) throw new XpAnalysisError('snapshot-shape')
  const snapshot = value as Snapshot
  if ((snapshot.phaseKind === 'test' && snapshot.winnerArm !== null)
    || (snapshot.phaseKind === 'rollout' && (snapshot.winnerArm === null || !(snapshot.winnerArm in snapshot.exposures.perArm)))
    || snapshot.verdict.headline !== snapshot.verdict.finding + (snapshot.verdict.action ? ` ${snapshot.verdict.action}` : '')
    || new Date(snapshot.window.to).getTime() < new Date(snapshot.window.from).getTime()) {
    throw new XpAnalysisError('snapshot-invariants')
  }
}

/** Assemble the already-computed snapshot at the pure/I/O boundary. */
export function assembleSnapshot(snapshot: Snapshot): Snapshot {
  validateSnapshot(snapshot)
  return snapshot
}

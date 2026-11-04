import type { RefusalCode } from './types/endpoints.js'
import type { Status } from './types/contracts.js'
export class XpNotImplemented extends Error {
  override name = 'XpNotImplemented'
  constructor(public readonly lane: string) { super(lane) }
}
export class XpLockedFieldError extends Error {
  override name = 'XpLockedFieldError'
  readonly status = 400
  readonly isPublic = true
  constructor(public readonly field: string, public readonly experimentStatus: Status) { super(`${field} is locked in ${experimentStatus}`) }
}
export class XpNoTransactionError extends Error {
  override name = 'XpNoTransactionError'
  constructor(message = 'An active transaction is required') { super(message) }
}
export class XpRefusal extends Error {
  override name = 'XpRefusal'
  readonly isPublic = true
  constructor(public readonly code: RefusalCode, message: string, public readonly detail: unknown | undefined, public readonly status: 409 | 413 | 422 | 500 | 404, options?: ErrorOptions) { super(message, options) }
}

/** Fixed analysis diagnostics: callers can choose a code, never supply log text. */
export type AnalysisErrorCode =
  | 'no-baseline'
  | 'primary-metric-count'
  | 'duplicate-metric'
  | 'invalid-timestamp'
  | 'window-hours'
  | 'window-before-start'
  | 'unknown-arm'
  | 'metric-not-supplied'
  | 'non-finite-values'
  | 'non-finite-covariates'
  | 'source-unavailable'
  | 'unit-type-unavailable'
  | 'srm-weights'
  | 'cuped-non-finite'
  | 'cuped-binomial'
  | 'seed-format'
  | 'snapshot-shape'
  | 'snapshot-invariants'

export const ANALYSIS_ERROR_MESSAGES: Readonly<Record<AnalysisErrorCode, string>> = Object.freeze({
  'no-baseline': 'Phase comparison baseline or shipped arm is missing',
  'primary-metric-count': 'Phase must have exactly one primary metric',
  'duplicate-metric': 'Duplicate metric id',
  'invalid-timestamp': 'Event or exposure timestamp is invalid',
  'window-hours': 'Attribution window must be a finite number of hours greater than 0',
  'window-before-start': 'Analysis window ends before the phase starts',
  'unknown-arm': 'Exposed unit has an unknown arm',
  'metric-not-supplied': 'Metric data was not supplied',
  'non-finite-values': 'Metric values must be finite',
  'non-finite-covariates': 'Covariates must be finite',
  'source-unavailable': 'Metric source unavailable',
  'unit-type-unavailable': 'Metric unit type unavailable',
  'srm-weights': 'SRM requires positive weights',
  'cuped-non-finite': 'Metric values and covariates must be finite',
  'cuped-binomial': 'Binomial values and covariates must be 0 or 1',
  'seed-format': 'Assignment seed must end in |',
  'snapshot-shape': 'Invalid Snapshot shape (all numbers must be finite)',
  'snapshot-invariants': 'Invalid Snapshot invariants',
})

export class XpAnalysisError extends Error {
  override name = 'XpAnalysisError'
  readonly code: AnalysisErrorCode
  constructor(code: AnalysisErrorCode) {
    super(ANALYSIS_ERROR_MESSAGES[code])
    this.code = code
  }
}

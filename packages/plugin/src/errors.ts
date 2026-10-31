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
  constructor() { super('An active transaction is required') }
}
export class XpRefusal extends Error {
  override name = 'XpRefusal'
  readonly isPublic = true
  constructor(public readonly code: RefusalCode, message: string, public readonly detail: unknown | undefined, public readonly status: 409 | 422 | 500 | 404) { super(message) }
}

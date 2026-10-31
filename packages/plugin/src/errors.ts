import type { RefusalCode } from './types/endpoints.js'
import type { Status } from './types/contracts.js'
export class XpNotImplemented extends Error {
  override name = 'XpNotImplemented'
  constructor(public readonly lane: string) { super(lane) }
}
export class XpLockedFieldError extends Error {
  override name = 'XpLockedFieldError'
  constructor(public readonly field: string, public readonly status: Status) { super(`${field} is locked in ${status}`) }
}
export class XpNoTransactionError extends Error {
  override name = 'XpNoTransactionError'
  constructor() { super('An active transaction is required') }
}
export class XpRefusal extends Error {
  override name = 'XpRefusal'
  constructor(public readonly code: RefusalCode, message: string, public readonly detail: unknown | undefined, public readonly status: 409 | 422) { super(message) }
}

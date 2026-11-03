import { XpNoTransactionError, XpNotImplemented, XpRefusal } from './errors.js'
import { ResultsBudgetError } from './db/pgExecutor.js'

/** Deliberately construct a plain object: host serializers must never see the error. */
export function safeError(err: unknown): { name: string; code?: string; stack?: string; message?: string } {
  if (!(err instanceof Error)) return { name: typeof err }
  const result: ReturnType<typeof safeError> = { name: typeof err.name === 'string' ? err.name : 'Error' }
  const code = 'code' in err ? err.code : undefined
  if (typeof code === 'string' && (/^[0-9A-Z]{5}$/.test(code) || err instanceof XpRefusal)) result.code = code
  // Keep frames only, including when the message spans several lines. Never
  // traverse cause or copy arbitrary enumerable database/error properties.
  const frames = typeof err.stack === 'string' ? err.stack.split('\n').filter(line => /^\s+at /.test(line)) : []
  if (frames.length) result.stack = frames.join('\n')
  // XpRefusal includes stored slugs; XpLockedFieldError includes request keys
  // and stored status. Neither class's message is safe to send to host logs.
  if (err instanceof XpNoTransactionError || err instanceof XpNotImplemented || err instanceof ResultsBudgetError) {
    result.message = err.message
  }
  return result
}

import { ANALYSIS_ERROR_MESSAGES, XpAnalysisError, XpNoTransactionError, XpNotImplemented, XpRefusal } from './errors.js'
import { ResultsBudgetError } from './db/pgExecutor.js'

/** Deliberately construct a plain object: host serializers must never see the error. */
export function safeError(err: unknown): { name: string; code?: string; stack?: string; message?: string } {
  try {
    if (!(err instanceof Error)) return { name: typeof err }
    const name = err.name
    const result: ReturnType<typeof safeError> = { name: typeof name === 'string' ? name : 'Error' }
    const code = 'code' in err ? err.code : undefined
    const analysisCode = err instanceof XpAnalysisError && typeof code === 'string' && Object.hasOwn(ANALYSIS_ERROR_MESSAGES, code) ? code as keyof typeof ANALYSIS_ERROR_MESSAGES : undefined
    if (typeof code === 'string' && (/^[0-9A-Z]{5}$/.test(code) || err instanceof XpRefusal || analysisCode)) result.code = code
    const message = err.message
    const stack = err.stack
    // Remove the entire V8 header first: message lines can impersonate frames.
    // Unknown stack formats fail closed. Never traverse cause or database fields.
    if (typeof name === 'string' && typeof message === 'string' && typeof stack === 'string') {
      const header = message ? `${name}: ${message}` : name
      const frames = stack.startsWith(`${header}\n`) ? stack.slice(header.length + 1).split('\n').filter(line => /^\s+at /.test(line)) : []
      if (frames.length) result.stack = frames.join('\n')
    }
    // XpRefusal includes stored slugs; XpLockedFieldError includes request keys
    // and stored status. Neither class's message is safe to send to host logs.
    // An analysis error's logged text always comes from the fixed table by code, never from err.message.
    if (analysisCode) result.message = ANALYSIS_ERROR_MESSAGES[analysisCode]
    else if (err instanceof XpNoTransactionError || err instanceof XpNotImplemented || err instanceof ResultsBudgetError) {
      if (typeof message === 'string') result.message = message
    }
    return result
  } catch {
    // Even instanceof, property existence checks and getters can throw on hosts' errors.
    return { name: 'Error' }
  }
}

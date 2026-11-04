/** DrizzleQueryError wraps driver errors; driver SQLSTATE can occur anywhere in cause. */
export function isPageBusy(error: unknown): boolean {
  const seen = new Set<unknown>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    const failure = error as { code?: string; cause?: unknown }
    if (failure.code === '40P01' || failure.code === '55P03') return true
    error = failure.cause
  }
  return false
}

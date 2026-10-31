'use client'

/** Prefer a caller's stable key; restricted browser crypto must not break the caller. */
export function idempotencyKey(provided?: string): string {
  // An empty key would collapse every conversion of this event for the unit into one dedupe row.
  if (provided) return provided
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* Try random bytes when UUID generation is unavailable. */ }
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  } catch { /* Older browsers can still generate a best-effort key. */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

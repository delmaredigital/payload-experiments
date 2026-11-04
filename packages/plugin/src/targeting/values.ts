/** Trim and deduplicate list inputs while preserving commas inside array items. */
export function coerceListValue(raw: unknown): string[] {
  return [...new Set((Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')]).map(value => value.trim()).filter(Boolean))]
}

/** Only the read boundary accepts legacy comma-separated document values. */
export function readListValue(raw: unknown): string[] {
  return coerceListValue(typeof raw === 'string' ? raw.split(',') : raw)
}

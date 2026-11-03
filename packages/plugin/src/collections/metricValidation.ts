/** Shared with the goals form; preserve Payload's field validation messages. */
export function validateCappingType(value: unknown, capValue: unknown, sourceKind?: string): true | string {
  const hasCapping = value != null || capValue != null
  if (hasCapping && sourceKind && sourceKind !== 'revenue') return 'Count and yes-or-no goals cannot use a limit.'
  return !hasCapping || value === 'percentile' || value === 'absolute' || 'Choose how to set the limit.'
}

export function validateCappingValue(value: unknown, type: unknown): true | string {
  if (value == null && !type) return true
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0 && (type === 'absolute' || (type === 'percentile' && value > 0 && value <= 1))) || 'Enter a valid limit (for past amounts, use a number greater than 0 and at most 1).'
}

export const TARGETING_OPS = { string: ['eq', 'neq', 'in', 'nin', 'contains'], number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], boolean: ['eq'] } as const
export type TargetingOp = (typeof TARGETING_OPS)[keyof typeof TARGETING_OPS][number]
export function isOpValid(type: string, op: string): op is TargetingOp {
  return Object.hasOwn(TARGETING_OPS, type) && (TARGETING_OPS[type as keyof typeof TARGETING_OPS] as readonly string[]).includes(op)
}
export function evaluateOp(type: string, op: string, actual: unknown, expected: unknown): boolean {
  if (!isOpValid(type, op) || typeof actual !== type) return false
  if (type === 'string') {
    const value = (actual as string).toLowerCase()
    if (op === 'in' || op === 'nin') {
      if (!Array.isArray(expected) || !expected.every(v => typeof v === 'string')) return false
      const found = expected.some(v => v.toLowerCase() === value)
      return op === 'in' ? found : !found
    }
    if (typeof expected !== 'string') return false
    const target = expected.toLowerCase()
    if (op === 'contains') return value.includes(target)
    return op === 'eq' ? value === target : value !== target
  }
  if (typeof expected !== type) return false
  if (type === 'boolean') return actual === expected
  if (type !== 'number' || !Number.isFinite(actual) || !Number.isFinite(expected)) return false
  const a = actual as number, b = expected as number
  switch (op) {
    case 'eq': return a === b
    case 'neq': return a !== b
    case 'gt': return a > b
    case 'gte': return a >= b
    case 'lt': return a < b
    case 'lte': return a <= b
    default: return false
  }
}

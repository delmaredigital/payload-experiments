import type { TargetingRule } from '../../types/contracts.js'
import type { SerializedAttributeKeys } from '../../types/admin.js'
import { TARGETING_OPS, isOpValid } from '../../targeting/ops.js'
import type { TargetingOp } from '../../targeting/ops.js'
import { NUMBER_OP_LABELS, STRING_OP_LABELS, AUDIENCE_COPY } from '../copy/audience.js'

type Attribute = SerializedAttributeKeys[string]
export type AttributeType = Attribute['type']
export function opsFor(type?: AttributeType): readonly TargetingOp[] { return type ? TARGETING_OPS[type] : [] }
export function opLabel(type: AttributeType, op: TargetingOp): string {
  if (!isOpValid(type, op)) return ''
  if (type === 'boolean') return STRING_OP_LABELS.eq
  return type === 'number' ? NUMBER_OP_LABELS[op as keyof typeof NUMBER_OP_LABELS] : STRING_OP_LABELS[op as keyof typeof STRING_OP_LABELS]
}
export function valueInput(attribute?: Attribute, op: TargetingOp = 'eq'): {
  kind: 'text' | 'number' | 'boolean' | 'select' | 'chips'; options?: { label: string; value: string }[]
} {
  const many = op === 'in' || op === 'nin'
  if (many) return { kind: 'chips' }
  if (attribute?.values) return { kind: 'select', options: attribute.values.map(value => ({ label: value, value })) }
  return { kind: attribute?.type === 'number' ? 'number' : attribute?.type === 'boolean' ? 'boolean' : 'text' }
}
export function coerceValue(type: AttributeType, op: TargetingOp, raw: unknown): string | number | boolean | string[] | null {
  if (!isOpValid(type, op)) return null
  if (type === 'string') {
    if (op === 'in' || op === 'nin') return [...new Set((Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')]).map(value => value.trim()).filter(Boolean))]
    return raw == null ? '' : String(raw)
  }
  if (type === 'number') {
    if (raw == null || typeof raw === 'string' && !raw.trim()) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }
  return raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : null
}
/** Only the read boundary accepts legacy comma-separated document values. */
export function readListValue(raw: unknown): string[] {
  return coerceValue('string', 'in', typeof raw === 'string' ? raw.split(',') : raw) as string[]
}
/** Normalize the read boundary before any whole-group edit. */
export function readTargetingRules(rules: TargetingRule[]): TargetingRule[] {
  return rules.map(rule => rule.op === 'in' || rule.op === 'nin' ? { ...rule, value: readListValue(rule.value) } : rule)
}
export function rowPath(path: string): string { return path.slice(0, Math.max(0, path.lastIndexOf('.'))) }
export function emptyListHint(op: TargetingOp, value: unknown): string | undefined {
  if (op !== 'in' && op !== 'nin') return undefined
  const list = readListValue(value)
  return Array.isArray(list) && list.length === 0 ? AUDIENCE_COPY.emptyListNote : undefined
}
export function humaniseAttribute(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

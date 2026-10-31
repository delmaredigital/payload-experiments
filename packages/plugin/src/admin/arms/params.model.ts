import type { Arm, ParamField } from '../../types/contracts.js'
import type { SerializedFlagPoint } from '../../types/admin.js'
import { ARMS_COPY } from '../copy/arms.js'

export function coerceParam(field: ParamField, value: unknown): unknown {
  if (field.type === 'number') {
    if (value === '' || value == null) return undefined
    return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  }
  if (field.type === 'checkbox') return value === true || value === 'true'
  return typeof value === 'string' ? value : ''
}
export function paramIssue(field: ParamField, value: unknown): string | null {
  const message = (copy: string) => copy.replace('{label}', field.label).replace('{min}', String(field.min)).replace('{max}', String(field.max))
  if (value == null || value === '') return field.required ? message(ARMS_COPY.paramRequired) : null
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return message(ARMS_COPY.paramNumber)
    if (field.min !== undefined && value < field.min) return message(ARMS_COPY.paramMin)
    if (field.max !== undefined && value > field.max) return message(ARMS_COPY.paramMax)
  } else if (field.type === 'checkbox') {
    if (typeof value !== 'boolean') return message(ARMS_COPY.paramCheckbox)
  } else if (field.type === 'select') {
    if (!field.options?.some(option => option.value === value)) return message(ARMS_COPY.paramOption)
  } else if (typeof value !== 'string' || field.required && !value.trim()) return message(ARMS_COPY.paramRequired)
  return null
}
export function paramsReadOnly(arm: Arm, editable: boolean): boolean { return !editable || arm.kind !== 'variant' }
export function paramsForArm(arm: Arm, point?: SerializedFlagPoint): Record<string, unknown> {
  return arm.kind !== 'variant' && point ? point.effectiveDefaults : arm.params ?? {}
}
export function setParam(params: Record<string, unknown>, key: string, field: ParamField, value: unknown): Record<string, unknown> {
  return { ...params, [key]: coerceParam(field, value) }
}

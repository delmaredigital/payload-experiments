import type { Arm, ParamField } from '../../../types/contracts.js'
import type { SerializedFlagPoint } from '../../../types/admin.js'
import { SETTING_COPY } from '../../copy/setting.js'

export function paramControl(field: ParamField): ParamField['type'] | 'segmented' {
  return field.type === 'select' && field.options?.length && field.options.length <= 4 ? 'segmented' : field.type
}

export function displayParam(field: ParamField, value: unknown): string {
  if (value == null || value === '') return SETTING_COPY.empty
  if (field.type === 'checkbox') return value === true ? SETTING_COPY.yes : value === false ? SETTING_COPY.no : SETTING_COPY.empty
  if (field.type === 'select') return field.options?.find(option => option.value === value)?.label ?? SETTING_COPY.empty
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? String(value) : SETTING_COPY.empty
  return typeof value === 'string' ? value : SETTING_COPY.empty
}

/** Bind against the current document, preserving every unrelated version field. */
export function bindSetting(arms: Arm[], point?: SerializedFlagPoint): Arm[] {
  return arms.map(arm => {
    const { params: _params, ...rest } = arm
    return arm.kind === 'holdout' ? rest : { ...rest, params: arm.kind === 'control' ? { ...point?.effectiveDefaults } : {} }
  })
}

/** Preflight identifies invalid values with { arm, field }, never editor-facing codes. */
export function paramCheckMessage(detail: unknown, armKey: string, key: string, field: ParamField): string | null {
  return Array.isArray(detail) && detail.some(item => item && item.arm === armKey && item.field === key)
    ? SETTING_COPY.invalid.replace('{label}', field.label) : null
}

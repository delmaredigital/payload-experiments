import { expect, test } from 'vitest'
import type { ParamField } from '../../../../src/types/contracts.js'
import { displayParam, paramCheckMessage, paramControl } from '../../../../src/testSurface/surface/setting/setting.model.js'
import { SETTING_COPY } from '../../../../src/testSurface/copy/setting.js'

test('small option sets use segments; larger, empty or absent option sets use a select', () => {
  for (const length of [0, 1, 4, 5]) {
    const field: ParamField = { type: 'select', label: 'Layout', options: Array.from({ length }, (_, index) => ({ label: String(index), value: String(index) })) }
    expect(paramControl(field)).toBe(length > 0 && length <= 4 ? 'segmented' : 'select')
  }
  expect(paramControl({ type: 'select', label: 'Layout' })).toBe('select')
  for (const type of ['checkbox', 'number', 'text', 'textarea'] as const) expect(paramControl({ type, label: 'Value' })).toBe(type)
})

test('values display in the language of each parameter type', () => {
  expect(displayParam({ type: 'checkbox', label: 'Enabled' }, true)).toBe('Yes')
  expect(displayParam({ type: 'checkbox', label: 'Enabled' }, false)).toBe('No')
  expect(displayParam({ type: 'number', label: 'Amount' }, 0)).toBe('0')
  expect(displayParam({ type: 'select', label: 'Layout', options: [{ value: 'private-id', label: 'Wide' }] }, 'private-id')).toBe('Wide')
  expect(displayParam({ type: 'text', label: 'Heading' }, 'Welcome')).toBe('Welcome')
  expect(displayParam({ type: 'textarea', label: 'Copy' }, 'One\nTwo')).toBe('One\nTwo')
  for (const value of [undefined, null, '', NaN, Infinity, 'bad']) expect(displayParam({ type: 'number', label: 'Amount' }, value)).toBe('Not set')
  expect(displayParam({ type: 'select', label: 'Layout', options: [] }, 'missing')).toBe('Not set')
})

test('preflight errors match both the version and the parameter', () => {
  const field: ParamField = { type: 'text', label: 'Heading' }
  const detail = [{ arm: 'variantA', field: 'heading' }]
  expect(paramCheckMessage(detail, 'variantA', 'heading', field)).toBe('Set a value for Heading.')
  expect(paramCheckMessage(detail, 'variantB', 'heading', field)).toBeNull()
  expect(paramCheckMessage(detail, 'variantA', 'other', field)).toBeNull()
  for (const value of [null, 'flag-params-invalid', {}, [null]]) expect(paramCheckMessage(value, 'variantA', 'heading', field)).toBeNull()
})

test('setting copy has no editor anti-goal words', () => {
  for (const copy of Object.values(SETTING_COPY)) expect(copy).not.toMatch(/\b(?:arms?|phases?|flag points?|unit type|CUPED|exposure policy)\b/i)
})

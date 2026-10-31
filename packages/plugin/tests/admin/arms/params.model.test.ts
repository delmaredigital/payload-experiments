import { expect, test } from 'vitest'
import type { Arm, ParamField } from '../../../src/types/contracts.js'
import type { SerializedFlagPoint } from '../../../src/types/admin.js'
import { coerceParam, paramIssue, paramsForArm, paramsReadOnly, setParam } from '../../../src/admin/arms/params.model.js'

test.each(['text', 'textarea'] as const)('%s coercion and required copy', type => {
  const field: ParamField = { type, label: 'Headline', required: true }
  expect(coerceParam(field, 123)).toBe('')
  expect(coerceParam(field, 'Hello')).toBe('Hello')
  expect(paramIssue(field, '')).toBe('Enter a value for Headline.')
  expect(paramIssue(field, '  ')).toBe('Enter a value for Headline.')
  expect(paramIssue(field, 'Hello')).toBeNull()
  expect(paramIssue({ ...field, required: false }, undefined)).toBeNull()
})
test('numbers preserve decimals, validate finite values and use required/min/max messages', () => {
  const field: ParamField = { type: 'number', label: 'Size', required: true, min: 1, max: 10 }
  expect(coerceParam(field, '2.5')).toBe(2.5)
  expect(coerceParam(field, '')).toBeUndefined()
  expect(paramIssue(field, undefined)).toBe('Enter a value for Size.')
  for (const value of [NaN, Infinity, 'bad']) expect(paramIssue(field, value)).toBe('Enter a number for Size.')
  expect(paramIssue(field, 0)).toBe('Size must be at least 1.')
  expect(paramIssue(field, 11)).toBe('Size must be at most 10.')
  expect(paramIssue(field, 1)).toBeNull()
  expect(paramIssue(field, 10)).toBeNull()
})
test('checkbox values are booleans and required false is valid', () => {
  const field: ParamField = { type: 'checkbox', label: 'Enabled', required: true }
  expect(coerceParam(field, true)).toBe(true)
  expect(coerceParam(field, 'false')).toBe(false)
  expect(paramIssue(field, false)).toBeNull()
  expect(paramIssue(field, 'false')).toBe('Choose yes or no for Enabled.')
  expect(paramIssue(field, undefined)).toBe('Enter a value for Enabled.')
})
test('selects accept only available values and provide option messages', () => {
  const field: ParamField = { type: 'select', label: 'Colour', required: true, options: [{ label: 'Red', value: 'red' }] }
  expect(coerceParam(field, 'red')).toBe('red')
  expect(paramIssue(field, '')).toBe('Enter a value for Colour.')
  expect(paramIssue(field, 'blue')).toBe('Choose an available option for Colour.')
  expect(paramIssue(field, 'red')).toBeNull()
})
test('Original shows effective defaults read-only, other groups use their saved params', () => {
  const arm: Arm = { key: 'control', kind: 'control', label: 'Original', weight: 50, params: { title: 'stale' } }
  const point: SerializedFlagPoint = { id: 'hero', label: 'Hero', params: {}, defaultParams: { title: 'default' }, effectiveDefaults: { title: 'current' } }
  expect(paramsReadOnly(arm, true)).toBe(true)
  expect(paramsForArm(arm, point)).toEqual({ title: 'current' })
  const variant: Arm = { ...arm, key: 'variantA', kind: 'variant' }
  expect(paramsReadOnly(variant, true)).toBe(false)
  expect(paramsReadOnly(variant, false)).toBe(true)
  expect(paramsForArm(variant, point)).toEqual({ title: 'stale' })
  expect(paramsForArm({ ...variant, params: undefined })).toEqual({})
  expect(setParam(variant.params!, 'size', { type: 'number', label: 'Size' }, '5')).toEqual({ title: 'stale', size: 5 })
  expect(variant.params).toEqual({ title: 'stale' })
})

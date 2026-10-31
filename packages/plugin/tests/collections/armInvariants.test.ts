import { expect, test } from 'vitest'
import type { Arm, ArmKey, ArmKind } from '../../src/types/contracts.js'
import type { ArmIssueCode } from '../../src/types/endpoints.js'
import { addHoldout, checkArms } from '../../src/collections/experiments/armInvariants.js'

const arm = (key: ArmKey, weight: number, kind: ArmKind = key === 'control' ? 'control' : key === 'holdout' ? 'holdout' : 'variant'): Arm =>
  ({ key, kind, label: key, weight, slot: key as Arm['slot'] })
const valid = () => [arm('control', 45), arm('variantA', 45), arm('holdout', 10)]

const failures: Array<[ArmIssueCode, Arm[]]> = [
  ['weights-total', [arm('control', 99)]],
  ['control-count', [arm('variantA', 100)]],
  ['control-first', [arm('variantA', 50), arm('control', 50)]],
  ['holdout-last', [arm('control', 45), arm('holdout', 10), arm('variantA', 45)]],
  ['holdout-count', [arm('control', 80), arm('holdout', 10), arm('holdout', 10)]],
  ['variant-count', [arm('control', 20), arm('variantA', 20), arm('variantB', 20), arm('variantC', 20), arm('variantA', 20)]],
  ['duplicate-key', [arm('control', 50), arm('control', 50, 'variant')]],
  ['slot-required', [{ ...arm('control', 100), slot: undefined }]],
  ['duplicate-slot', [arm('control', 50), { ...arm('variantA', 50), slot: 'control' }]],
]
test.each(failures)('%s has a failing input', (code, arms) => {
  expect(checkArms(arms, 'block').map(issue => issue.code)).toContain(code)
})
test('valid 45/45/10 block experiment', () => expect(checkArms(valid(), 'block')).toEqual([]))
test.each([-1, 0.5, NaN, Infinity])('rejects invalid weight %s even if total could be 100', weight => {
  expect(checkArms([arm('control', weight), arm('variantA', 100 - weight)], 'flag').map(issue => issue.code)).toContain('weights-total')
})
test('requires exactly one control, including when two are supplied', () => {
  expect(checkArms([arm('control', 50), arm('variantA', 50, 'control')], 'flag').map(issue => issue.code)).toContain('control-count')
})
test('fixed vocabulary and block slots matching keys', () => {
  expect(checkArms([arm('unknown' as ArmKey, 100, 'control')], 'flag')).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate-key', armIndex: 0, armKey: 'unknown' })]))
  expect(checkArms([{ ...arm('control', 100), slot: 'variantA' }], 'block').map(issue => issue.code)).toContain('slot-required')
})
test.each(['flag', 'page', 'code'] as const)('%s does not require slots', kind => {
  expect(checkArms([{ ...arm('control', 100), slot: undefined }], kind)).toEqual([])
})
test('zero weights are allowed', () => expect(checkArms([arm('control', 100), arm('variantA', 0)], 'block')).toEqual([]))
test('50/50 becomes 45/45/10 without mutating the input', () => {
  const arms = [arm('control', 50), arm('variantA', 50)]
  const before = structuredClone(arms)
  const result = addHoldout(arms)
  expect(result.map(arm => arm.weight)).toEqual([45, 45, 10])
  expect(arms).toEqual(before)
  expect(checkArms(result, 'block')).toEqual([])
})
test('largest remainder on 34/33/33', () => {
  const result = addHoldout([arm('control', 34), arm('variantA', 33), arm('variantB', 33)])
  expect(result.map(arm => arm.weight)).toEqual([30, 30, 30, 10])
  expect(result.every(arm => Number.isInteger(arm.weight))).toBe(true)
  expect(result.reduce((sum, arm) => sum + arm.weight, 0)).toBe(100)
})
test('control wins a rounding tie even if not first', () => {
  expect(addHoldout([arm('variantA', 25), arm('control', 25), arm('variantB', 25), arm('variantC', 25)]).map(arm => arm.weight)).toEqual([23, 23, 22, 22, 10])
})
test('existing holdout is a no-op', () => {
  const arms = valid()
  expect(addHoldout(arms)).toBe(arms)
})

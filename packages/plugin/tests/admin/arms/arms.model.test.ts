import { expect, test } from 'vitest'
import type { Arm } from '../../../src/types/contracts.js'
import { checkArms } from '../../../src/collections/experiments/armInvariants.js'
import { addHoldoutArm, addVariant, issuesByRow, readArms, removeArm, removeHoldout, setWeight, splitEvenly } from '../../../src/admin/arms/arms.model.js'

function groups(weights: number[]): Arm[] {
  const keys = ['control', 'variantA', 'variantB', 'variantC'] as const
  return weights.map((weight, i) => ({ key: keys[i]!, kind: i ? 'variant' : 'control', label: i ? `Variant ${i}` : 'Original', slot: keys[i]!, weight }))
}
function blockSlots(arms: Arm[]) {
  for (const arm of arms) {
    if (arm.kind === 'holdout') expect(arm).not.toHaveProperty('slot')
    else expect(arm.slot).toBe(arm.key)
  }
  expect(new Set(arms.map(arm => arm.key)).size).toBe(arms.length)
  const slots = arms.flatMap(arm => arm.slot ? [arm.slot] : [])
  expect(new Set(slots).size).toBe(slots.length)
}
function total100(arms: Arm[]) {
  expect(arms.reduce((sum, arm) => sum + arm.weight, 0)).toBe(100)
  expect(arms.every(arm => Number.isInteger(arm.weight) && arm.weight >= 0)).toBe(true)
}
test('seeded 2–4 group integer vectors retain totals, order and block slots through every operation', () => {
  let seed = 0xadc03
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max }
  for (let n = 0; n < 300; n++) {
    const count = 2 + random(3)
    const cuts = [0, ...Array.from({ length: count - 1 }, () => random(101)), 100].sort((a, b) => a - b)
    const original = groups(cuts.slice(1).map((cut, i) => cut - cuts[i]!))
    const before = structuredClone(original)
    const held = addHoldoutArm(original)
    total100(held); blockSlots(held)
    expect(held.at(-1)).toEqual({ key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 })
    expect(held.slice(0, -1).map(arm => arm.key)).toEqual(original.map(arm => arm.key))
    expect(addHoldoutArm(held)).toBe(held)
    const removed = removeHoldout(held)
    total100(removed); blockSlots(removed)
    expect(removed.some(arm => arm.kind === 'holdout')).toBe(false)
    expect(removed.map(arm => arm.key)).toEqual(original.map(arm => arm.key))
    const even = splitEvenly(held)
    total100(even); blockSlots(even)
    expect(even.at(-1)!.weight).toBe(10)
    expect(Math.max(...even.slice(0, -1).map(arm => arm.weight)) - Math.min(...even.slice(0, -1).map(arm => arm.weight))).toBeLessThanOrEqual(1)
    blockSlots(addVariant(held)); blockSlots(removeArm(held, 'variantA')); blockSlots(setWeight(held, 'variantA', 0))
    expect(checkArms(held, 'block')).toEqual([])
    expect(original).toEqual(before)
  }
})
test('largest remainder ties go to Original, even if it is not first', () => {
  const rows = groups([1, 1, 1])
  expect(removeHoldout([...rows, { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 97 }]).map(arm => arm.weight)).toEqual([34, 33, 33])
  expect(splitEvenly(groups([34, 33, 33])).map(arm => arm.weight)).toEqual([34, 33, 33])
  expect(removeHoldout([...groups([0, 0]), { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 100 }]).map(arm => arm.weight)).toEqual([50, 50])
  expect(removeHoldout([...groups([20, 20]), { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 }]).map(arm => arm.weight)).toEqual([25, 25])
})
test('variants use the next free standard key, start at zero, and are inserted before holdout', () => {
  let rows = addHoldoutArm(groups([50, 50]))
  rows = addVariant(rows, 'block')
  expect(rows.map(arm => arm.key)).toEqual(['control', 'variantA', 'variantB', 'holdout'])
  expect(rows[2]).toMatchObject({ label: 'Variant B', weight: 0, slot: 'variantB' })
  rows = addVariant(rows, 'block')
  expect(addVariant(rows)).toBe(rows)
  const removed = removeArm(rows, 'variantB')
  expect(addVariant(removed)[3]!.key).toBe('variantB')
  blockSlots(addVariant(removed))
  expect(removeArm(rows, 'control')).toBe(rows)
  expect(addVariant(groups([50, 50]).map(({ slot: _slot, ...arm }) => arm), 'page')[2]).not.toHaveProperty('slot')
})
test('weight editing never rebalances other groups; removal uses proportional rebalance only for holdout', () => {
  const rows = groups([70, 30])
  expect(setWeight(rows, 'variantA', 20).map(arm => arm.weight)).toEqual([70, 20])
  expect(removeArm(rows, 'variantA').map(arm => arm.weight)).toEqual([70])
  const held = addHoldoutArm(rows)
  expect(removeArm(held, 'holdout')).toEqual(removeHoldout(held))
  expect(removeHoldout(rows)).toBe(rows)
})
test('issues stay on the checker row, with unattached totals at form level', () => {
  const rows = groups([50, 49])
  rows[1] = { ...rows[1]!, key: 'custom' as Arm['key'], slot: undefined }
  const result = issuesByRow(rows, 'block')
  expect(result.form.map(issue => issue.code)).toEqual(['weights-total'])
  expect(result.rows[0]).toEqual([])
  expect(result.rows[1]!.map(issue => issue.code)).toEqual(['invalid-key', 'slot-required'])
  expect([...result.form, ...result.rows.flat()]).toEqual(expect.arrayContaining(checkArms(rows, 'block')))
})
test('reads flat Payload field paths in numeric order without unrelated fields', () => {
  expect(readArms({ 'arms.1.key': { value: 'variantA' }, 'arms.0.key': { value: 'control' }, 'arms.0.weight': { value: 50 }, kind: { value: 'block' } }).map(arm => arm.key)).toEqual(['control', 'variantA'])
})

import { expect, test } from 'vitest'
import { allocationGroups, allocationLayer, allocationSentence } from '../../../src/admin/allocation.model.js'
import type { AllocationGroup } from '../../../src/admin/allocation.model.js'

const groups = (weights: number[]): AllocationGroup[] => weights.map((weight, index) => ({
  key: (['control', 'variantA', 'variantB'] as const)[index]!, kind: index ? 'variant' : 'control', weight,
}))
const sentence = (weights: number[], allocation = 50) => allocationSentence({ allocation, unitType: 'visitor', arms: groups(weights), status: 'draft' })
test('equal groups use the exact participation sentence', () => {
  expect(sentence([50, 50])).toBe('50% of visitors take part: about 25% see each version; the rest see the Original and are not counted')
})
test('unequal groups and signed-in users show each share, rounded to one decimal', () => {
  expect(allocationSentence({ allocation: 30, unitType: 'user', arms: groups([34, 33, 33]), status: 'stopped' }))
    .toBe('30% of signed-in users take part: about 10.2% see the Original, 9.9% see Variant A, 9.9% see Variant B; the rest see the Original and are not counted')
  expect(sentence([33, 67], 33)).toContain('10.9% see the Original, 22.1% see Variant A')
  expect(sentence([50, 50], 100)).toContain('50% see each version')
  expect(sentence([50, 50], 1)).toContain('0.5% see each version')
})
test('a holdout is measured and uses its share of enrolled people', () => {
  expect(allocationSentence({ allocation: 50, unitType: 'visitor', status: 'draft', arms: [
    ...groups([45, 45]), { key: 'holdout', kind: 'holdout', weight: 10 },
  ] })).toBe('50% of visitors take part: about 22.5% see each version; the holdout (10% of them) sees the Original and is measured; everyone else sees the Original and is not counted.')
})
test('layer usage and running guidance are appended', () => {
  const output = allocationSentence({ allocation: 50, unitType: 'visitor', arms: groups([50, 50]), status: 'running', layer: { name: 'Homepage', used: 50, free: 30 } })
  expect(output).toBe(sentence([50, 50]) + '. Uses 50 of the 100 slices in layer Homepage; 30 are free. Raise it from the actions panel; lowering takes effect in the next round.')
})
test('running without a holdout starts a new sentence', () => {
  expect(allocationSentence({ allocation: 50, unitType: 'visitor', arms: groups([50, 50]), status: 'running' }))
    .toBe(sentence([50, 50]) + '. Raise it from the actions panel; lowering takes effect in the next round.')
})
test('layer without a holdout starts a new sentence', () => {
  expect(allocationSentence({ allocation: 50, unitType: 'visitor', arms: groups([50, 50]), status: 'draft', layer: { name: 'Home', used: 50, free: 30 } }))
    .toBe(sentence([50, 50]) + '. Uses 50 of the 100 slices in layer Home; 30 are free.')
})
test('holdout suffixes keep a single period and space', () => {
  const arms: AllocationGroup[] = [...groups([45, 45]), { key: 'holdout', kind: 'holdout', weight: 10 }]
  const base = allocationSentence({ allocation: 50, unitType: 'visitor', arms, status: 'draft' })
  expect(allocationSentence({ allocation: 50, unitType: 'visitor', arms, status: 'running', layer: { name: 'Home', used: 50, free: 30 } }))
    .toBe(base + ' Uses 50 of the 100 slices in layer Home; 30 are free. Raise it from the actions panel; lowering takes effect in the next round.')
})
test('reads flattened form rows in order and omits incomplete layer data', () => {
  expect(allocationGroups({ arms: { value: 2 }, 'arms.1.key': { value: 'variantA' }, 'arms.1.kind': { value: 'variant' }, 'arms.1.weight': { value: 60 },
    'arms.0.key': { value: 'control' }, 'arms.0.kind': { value: 'control' }, 'arms.0.weight': { value: 40 } })).toEqual(groups([40, 60]))
  expect(allocationGroups({ arms: { value: groups([50, 50]) } })).toEqual(groups([50, 50]))
  expect(allocationLayer('layer-id')).toBeUndefined()
  expect(allocationLayer({ name: 'Layer' })).toBeUndefined()
  expect(allocationLayer({ name: 'Layer', used: 20, free: 80 })).toEqual({ name: 'Layer', used: 20, free: 80 })
  expect(sentence([], 50)).toBe('')
})

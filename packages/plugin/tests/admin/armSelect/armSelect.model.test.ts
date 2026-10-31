import { expect, test } from 'vitest'
import { bindArmSelect } from '../../../src/admin/armSelect/armSelect.model.js'
import type { ArmSelectExperiment } from '../../../src/admin/armSelect/armSelect.model.js'

const draft: ArmSelectExperiment = { id: 1, name: 'Earlier test', status: 'draft', arms: [
  { key: 'control', kind: 'control', label: 'Original' }, { key: 'variantA', kind: 'variant', label: 'New heading' },
  { key: 'holdout', kind: 'holdout', label: 'Holdout' },
] }
test('live wins over a stored candidate; stale copy identifies the earlier experiment', () => {
  const live = { ...draft, id: 2, status: 'running' as const }
  const result = bindArmSelect({ live, candidates: [draft], stored: { experiment: 1, arm: 'variantA' } })
  expect(result.bound).toBe(live)
  expect(result.pickable).toBe(false)
  expect(result.stale).toBe("This was set for an earlier experiment (Earlier test) and won't be used now.")
})
test('picks the stored candidate, comparing numeric and string ids', () => {
  const result = bindArmSelect({ candidates: [draft], stored: { experiment: '1' } })
  expect(result.bound).toBe(draft)
  expect(result.pickable).toBe(true)
  expect(result.stale).toBeNull()
  expect(result.options).toEqual([{ label: 'Original', value: 'control' }, { label: 'New heading', value: 'variantA' }])
})
test('no candidate is selected implicitly; a populated stale reference keeps its name', () => {
  expect(bindArmSelect({ candidates: [draft], stored: {} }).bound).toBeNull()
  const result = bindArmSelect({ candidates: [], stored: { experiment: { id: 9, name: 'Old copy' } } })
  expect(result.pickable).toBe(true)
  expect(result.stale).toBe("This was set for an earlier experiment (Old copy) and won't be used now.")
  expect(bindArmSelect({ candidates: [], stored: { experiment: null, arm: null } }).stale).toBeNull()
})
test.each(['draft', 'stopped', 'running', 'decided'] as const)('banner only while running (%s)', status => {
  const doc = { ...draft, status }
  const result = bindArmSelect({ live: status === 'running' || status === 'decided' ? doc : null, candidates: [doc], stored: { experiment: '1' } })
  expect(result.banner).toBe(status === 'running' ? 'Changing this content mid-test mixes two versions in one result' : null)
  expect(result.options.some(option => option.value === 'holdout')).toBe(false)
})

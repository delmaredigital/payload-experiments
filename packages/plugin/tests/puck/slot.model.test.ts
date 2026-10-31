import { expect, test } from 'vitest'
import type { ArmSlot } from '../../src/types/puck.js'
import { slotToRender } from '../../src/puck/slot.model.js'

test.each<ArmSlot>(['control', 'variantA', 'variantB', 'variantC'])('%s selects itself', xpSlot => {
  expect(slotToRender({ xpSlot })).toBe(xpSlot)
})

test('missing and unknown slots select the Original', () => {
  expect(slotToRender({})).toBe('control')
  for (const xpSlot of ['holdout', 'unknown', 'constructor', null, 0]) {
    expect(slotToRender({ xpSlot: xpSlot as ArmSlot })).toBe('control')
  }
})

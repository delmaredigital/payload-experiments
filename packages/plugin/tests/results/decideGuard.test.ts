import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { decideGuard } from '../../src/results/decideGuard.js'
import type { Snapshot } from '../../src/types/snapshot.js'

function snapshot(): Snapshot {
  return JSON.parse(readFileSync(new URL('../_fixtures/snapshots/T7.json', import.meta.url), 'utf8'))
}

test('no snapshot requires confirmation and a note', () => {
  expect(decideGuard(null, 'variantA')).toBe(true)
})
test('no recommendation requires confirmation and a note', () => {
  const value = snapshot()
  value.verdict.recommendedArm = null
  expect(decideGuard(value, 'variantA')).toBe(true)
})
test('a different choice requires confirmation and a note', () => {
  expect(decideGuard(snapshot(), 'control')).toBe(true)
})
test.each([1, 2, 3, 4] as const)('row %s is guarded even when the recommendation matches', row => {
  const value = snapshot()
  value.verdict.row = row
  expect(decideGuard(value, 'variantA')).toBe(true)
})
test.each([5, 6, 7, 8, 9, 10, 'R1', 'R2', 'R3'] as const)('row %s has no additional row guard', row => {
  const value = snapshot()
  value.verdict.row = row
  expect(decideGuard(value, 'variantA')).toBe(false)
})

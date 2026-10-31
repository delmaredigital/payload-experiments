import { expect, test } from 'vitest'
import { assignArm } from '@delmaredigital/experiments-stats'
import { newSeed } from '../../src/runtime/seed.js'

test('seeds are random 128-bit lowercase hex with the assignment separator', () => {
  const seeds = Array.from({ length: 100 }, newSeed)
  expect(new Set(seeds).size).toBe(100)
  for (const seed of seeds) {
    expect(seed).toMatch(/^[a-f0-9]{32}\|$/)
    expect([0, 1]).toContain(assignArm({ seed, unitId: 'visitor', weights: [50, 50], coverage: 1 }))
  }
})

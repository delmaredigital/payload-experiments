import { describe, expect, it } from 'vitest'
import { armWeightsToFractions, assignArm, layerSlice, rolloutBucketRanges } from '../../src/assignment/plugin.js'
import { chooseVariation, getBucketRanges, hash, inRange } from '../../src/assignment/sdk.js'

function randomVectors(n: number): number[][] {
  let state = 0x51a7e + n
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state >>> 8
  }
  // High bits avoid the LCG's short low-bit periods; dedupe to cover 2000 distinct vectors.
  const vectors: number[][] = []
  const seen = new Set<string>()
  while (vectors.length < 2000) {
    const h = 1 + next() % 100
    let remaining = 100 - h
    const weights: number[] = []
    for (let i = 0; i < n - 2; i++) {
      const w = next() % (remaining + 1)
      weights.push(w)
      remaining -= w
    }
    const vector = [...weights, remaining, h]
    const key = vector.join(',')
    if (!seen.has(key)) {
      seen.add(key)
      vectors.push(vector)
    }
  }
  return vectors
}

function checkRollout(weights: number[], coverage: number): void {
  const testRanges = getBucketRanges(weights.length, coverage, armWeightsToFractions(weights))
  const testHoldout = testRanges[weights.length - 1]!
  const rollout = rolloutBucketRanges(weights, coverage)
  // Exact equality protects SDK float accumulation: recomputing 0.98 changes membership.
  expect(rollout.holdout).toEqual(testHoldout)
  expect(rollout.winner).toEqual([0, coverage * rollout.holdout[0]])
  // Use a tight loop instead of hundreds of millions of assertion objects.
  // Every membership predicate still calls the public SDK inRange function.
  for (let k = 0; k < 10000; k++) {
    const point = k / 10000
    const held = inRange(point, rollout.holdout)
    if (inRange(point, testHoldout) !== held || (held && inRange(point, rollout.winner))) {
      throw new Error(`Rollout membership: weights=${weights}, coverage=${coverage}, k=${k}`)
    }
  }
}

describe('plugin assignment', () => {
  it('uses SDK float ranges for 45/45/10 at full coverage', () => {
    const actual = getBucketRanges(3, 1, armWeightsToFractions([45, 45, 10]))
    const expected = [[0, 0.45], [0.45, 0.9], [0.9, 1]]
    for (let i = 0; i < expected.length; i++) {
      for (let j = 0; j < 2; j++) expect(actual[i]![j]).toBeCloseTo(expected[i]![j]!, 15)
    }
  })

  it('validates weights, seed suffix, and rollout holdout', () => {
    for (const weights of [[], [49, 50], [49.5, 50.5], [-1, 101], [NaN, 100], [Infinity, 0]]) {
      expect(() => armWeightsToFractions(weights)).toThrow(RangeError)
      expect(() => assignArm({ seed: 'exp|', unitId: 'u0', weights, coverage: 1 })).toThrow(RangeError)
      expect(() => rolloutBucketRanges(weights, 1)).toThrow(RangeError)
    }
    expect(() => assignArm({ seed: 'exp', unitId: 'u0', weights: [50, 50], coverage: 1 })).toThrow(RangeError)
    for (const weights of [[100], [50, 50, 0]]) expect(() => rolloutBucketRanges(weights, 1)).toThrow(RangeError)
    expect(armWeightsToFractions([0, 100])).toEqual([0, 1])
  })

  it('composes assignment and layer hashing with the documented seeds', () => {
    const args = { seed: 'exp|', unitId: '用户-🧪', weights: [45, 45, 10], coverage: 0.3 }
    expect(assignArm(args)).toBe(chooseVariation(hash(args.seed, args.unitId, 2)!, getBucketRanges(3, 0.3, [0.45, 0.45, 0.1])))
    expect(layerSlice('layer-a', args.unitId)).toBe(Math.floor(hash('layer-a|', args.unitId, 2)! * 100))
  })

  it('preserves rollout membership for every three-arm vector and seeded four/five-arm samples', { timeout: 60_000 }, () => {
    let vectors = 0
    for (let h = 1; h <= 50; h++) {
      for (let a = 0; a <= 100 - h; a++) {
        for (const c of [0.3, 0.5, 1]) checkRollout([a, 100 - a - h, h], c)
        vectors++
      }
    }
    for (const n of [4, 5]) {
      const sample = randomVectors(n)
      expect(sample).toHaveLength(2000)
      expect(new Set(sample.map(weights => weights.join(','))).size).toBe(2000)
      for (const weights of sample) {
        for (const c of [0.3, 0.5, 1]) checkRollout(weights, c)
        vectors++
      }
    }
    expect(vectors).toBe(7775)
  })

  it('preserves the narrow [5,93,2] holdout, including exact endpoints', () => {
    for (const c of [0.3, 0.5, 1]) {
      checkRollout([5, 93, 2], c)
      const { holdout, winner } = rolloutBucketRanges([5, 93, 2], c)
      expect(holdout).toEqual([0.05 + 0.93, 0.05 + 0.93 + c * 0.02])
      expect(inRange(holdout[0], holdout)).toBe(true)
      expect(inRange(holdout[1], holdout)).toBe(false)
      expect(inRange(winner[1], winner)).toBe(false)
      expect(winner[1]).toBeLessThanOrEqual(holdout[0])
    }
  })
})

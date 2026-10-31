import { expect, it } from 'vitest'
import { assignArm, layerSlice } from '../../src/assignment/plugin.js'
import { chooseVariation, getBucketRanges, hash } from '../../src/assignment/sdk.js'

const N = 1_000_000
const weightSets = [[50, 50], [45, 45, 10], [34, 33, 33]]
let cachedHashes: Float64Array | undefined
function unitHashes(): Float64Array {
  if (!cachedHashes) {
    cachedHashes = new Float64Array(N)
    for (let i = 0; i < N; i++) cachedHashes[i] = hash('exp-a|', `u${i}`, 2)!
  }
  return cachedHashes
}

it('never changes the arm of an enrolled unit as coverage rises', { timeout: 30_000 }, () => {
  const hashes = unitHashes()
  const coverages = [0.05, ...Array.from({ length: 10 }, (_, i) => (i + 1) / 10)]
  for (const weights of weightSets) {
    const ranges = coverages.map(c => getBucketRanges(weights.length, c, weights.map(w => w / 100)))
    for (let i = 0; i < N; i++) {
      let enrolledArm = -1
      for (const buckets of ranges) {
        const arm = chooseVariation(hashes[i]!, buckets)
        if (enrolledArm !== -1 && arm !== enrolledArm) {
          throw new Error(`Coverage reassigned u${i}, weights=${weights}, from=${enrolledArm}, to=${arm}`)
        }
        if (arm !== -1) enrolledArm = arm
      }
    }
  }
})

it('matches every full-coverage arm share within four binomial standard deviations', { timeout: 30_000 }, () => {
  const hashes = unitHashes()
  for (const weights of weightSets) {
    const ranges = getBucketRanges(weights.length, 1, weights.map(w => w / 100))
    const counts = new Array<number>(weights.length).fill(0)
    for (const value of hashes) {
      const arm = chooseVariation(value, ranges)
      if (arm === -1) throw new Error('Full coverage left a unit unenrolled')
      counts[arm] = counts[arm]! + 1
    }
    expect(counts.reduce((a, b) => a + b, 0)).toBe(N)
    weights.forEach((weight, arm) => {
      const p = weight / 100
      const sigma = Math.sqrt(N * p * (1 - p))
      expect(Math.abs(counts[arm]! - N * p), `weights=${weights}, arm=${arm}`).toBeLessThanOrEqual(4 * sigma)
    })
  }
})

it('keeps layer slices uniform and independent of experiment arms', { timeout: 30_000 }, () => {
  const table = Array.from({ length: 100 }, () => [0, 0])
  const columns = [0, 0]
  const weights = [50, 50]
  // Each id is hashed once for each of layer-x| and exp-x|. The exp-a| hashes
  // used above are cached and reused for all weights and coverage thresholds.
  for (let i = 0; i < N; i++) {
    const unitId = `u${i}`
    const slice = layerSlice('layer-x', unitId)
    const arm = assignArm({ seed: 'exp-x|', unitId, weights, coverage: 1 })
    if (slice < 0 || slice >= 100 || (arm !== 0 && arm !== 1)) throw new Error(`Invalid assignment for ${unitId}`)
    table[slice]![arm] = table[slice]![arm]! + 1
    columns[arm] = columns[arm]! + 1
  }
  let chiSquare = 0
  for (const [slice, row] of table.entries()) {
    const count = row[0]! + row[1]!
    expect(Math.abs(count - 10_000), `slice=${slice}`).toBeLessThanOrEqual(5 * Math.sqrt(N * 0.01 * 0.99))
    for (let arm = 0; arm < 2; arm++) {
      const expected = count * columns[arm]! / N
      chiSquare += (row[arm]! - expected) ** 2 / expected
    }
  }
  // Pearson df = (100−1)(2−1) = 99. Wilson–Hilferty approximation at
  // upper-tail p=1e−6: z=4.753424308822899 (normal 0.999999 quantile),
  // 99 * (1 − 2/(9*99) + z*sqrt(2/(9*99)))^3 = 181.0818411748755.
  const critical = 99 * (1 - 2 / (9 * 99) + 4.753424308822899 * Math.sqrt(2 / (9 * 99))) ** 3
  expect(chiSquare).toBeLessThan(critical)
})

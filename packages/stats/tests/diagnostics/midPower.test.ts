import { describe, expect, it } from 'vitest'
import { midExperimentPower } from '../../src/diagnostics/midExperimentPower.js'
import { abTestMoments } from '../../src/effectMoments.js'
import { sequentialTwoSidedTTest } from '../../src/frequentist/sequential.js'
import { decode, loadFixture } from '../parity/fixtures.js'
import { expectParity } from '../parity/compare.js'

const a = { type: 'sampleMean', n: 1000, sum: 2000, sumSquares: 6000 } as const
const b = { type: 'sampleMean', n: 1200, sum: 2640, sumSquares: 8200 } as const
const moments = abTestMoments(a, b)
const result = sequentialTwoSidedTTest(a, b)

describe('mid-experiment power identities', () => {
  it('encodes already powered as zero scaling and null additional pairwise users', () => {
    const output = midExperimentPower(moments, result, {}, { targetMde: 10 })
    expect(output.scalingFactor).toBe(0)
    expect(output.additionalUsers).toBeNull()
    expect(output.updateMessage).toBe('successful')
    expect(output.upperBoundAchieved).toBe(false)
  })

  it('passes through test errors with the complete default shape', () => {
    expect(midExperimentPower(moments, { errorMessage: 'test error' }, {}, { targetPower: 0.9 })).toEqual({
      error: 'test error', updateMessage: 'unsuccessful', additionalUsers: 0,
      scalingFactor: null, upperBoundAchieved: false, targetPower: 0.9,
    })
  })

  it('echoes target power for successful and infeasible estimates', () => {
    for (const targetPower of [0.6, 0.8, 0.9]) {
      for (const targetMde of [0.01, 0.05, 10, 1e-12]) {
        expect(midExperimentPower(moments, result, {}, { targetPower, targetMde }).targetPower).toBe(targetPower)
      }
    }
  })

  it('never increases scaling when existing data grows at fixed per-unit variance', () => {
    for (const sequential of [false, true]) {
      for (const priorEffect of [null, { mean: 0, variance: 0.09, proper: true }]) {
        let previous = Infinity
        for (const factor of [1, 2, 4, 16]) {
          const moreData = { ...moments, pairwiseSampleSize: moments.pairwiseSampleSize * factor,
            standardError: moments.standardError / Math.sqrt(factor) }
          const output = midExperimentPower(moreData, result, {}, { sequential, priorEffect, targetMde: 0.05 })
          expect(output.updateMessage).toBe('successful')
          expect(output.scalingFactor).not.toBeNull()
          expect(output.scalingFactor!).toBeLessThanOrEqual(previous)
          if (output.scalingFactor === 0) expect(output.additionalUsers).toBeNull()
          else expect(output.additionalUsers).toBe(moreData.pairwiseSampleSize * output.scalingFactor!)
          previous = output.scalingFactor!
        }
      }
    }
  })

  it('throws the six-element upstream payload when NaN prevents convergence', () => {
    // A deterministic extreme input: NaN power never satisfies the tolerance.
    expect(() => midExperimentPower({ ...moments, standardError: NaN }, result, {}))
      .toThrow(/^\[NaN, 0\.8, NaN, [^,]+, [^,]+, [^,]+\]$/)
  })
})

const fixture = loadFixture('midPower.midExperimentPower')
describe('midPower.midExperimentPower parity', () => {
  if (!fixture) {
    it.skip('awaits midPower.midExperimentPower.json generated on this lane’s train', () => {})
  } else {
    for (const { name, input, expected } of fixture.cases) {
      it(name, () => {
        const args = decode(input.args) as Parameters<typeof midExperimentPower>
        if (expected !== null && typeof expected === 'object' && '$raises' in expected) {
          expect(() => midExperimentPower(...args)).toThrow()
        } else expectParity(midExperimentPower(...args), decode(expected))
      })
    }
  }
})

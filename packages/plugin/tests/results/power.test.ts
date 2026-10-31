import { expect, test } from 'vitest'
import { abTestMoments, buildStatistic, DEFAULT_GAUSSIAN_PRIOR, midExperimentPower, sequentialTwoSidedTTest } from '@delmaredigital/experiments-stats'
import { remainingPower } from '../../src/results/power.js'

const a = buildStatistic('binomial', { n: 2000, sum: 400, sumSquares: 400 })
const b = buildStatistic('binomial', { n: 2000, sum: 410, sumSquares: 410 })
const input = { baseline: a, variants: [b], elapsedDays: 14, alpha: .025, method: 'sequential' as const,
  sequentialTuningParameter: 5000, prior: DEFAULT_GAUSSIAN_PRIOR }

test('pairwise additional users become per-arm totals and days using observed exposure traffic', () => {
  const moments = abTestMoments(a, b)
  const result = sequentialTwoSidedTTest(a, b, { alpha: input.alpha, sequentialTuningParameter: 5000 })
  const expected = midExperimentPower(moments, result, { alpha: input.alpha }, {
    targetMde: .1, targetPower: .8, sequential: true, sequentialTuningParameter: 5000, priorEffect: null,
  })
  const additional = expected.scalingFactor === 0 ? 0 : expected.additionalUsers!
  const days = Math.ceil(additional / (4000 / 14))
  expect(remainingPower(input)).toEqual({ daysRemaining: days, exposuresNeededPerArm: Math.ceil((4000 + additional) / 2),
    lowerBound: true, feasible: days <= 90 })
})

test('unknown time or variance produces an unknown estimate, never zero days', () => {
  expect(remainingPower({ ...input, elapsedDays: 0 }).daysRemaining).toBeNull()
  const empty = buildStatistic('count', { n: 0, sum: 0, sumSquares: 0 })
  expect(remainingPower({ ...input, baseline: empty, variants: [empty] }).daysRemaining).toBeNull()
})

test('already powered is zero despite upstream additionalUsers=null; Bayesian is not a lower-bound estimate', () => {
  const many = buildStatistic('binomial', { n: 1_000_000, sum: 200_000, sumSquares: 200_000 })
  expect(remainingPower({ ...input, baseline: many, variants: [many] }).daysRemaining).toBe(0)
  expect(remainingPower({ ...input, method: 'bayesian' }).lowerBound).toBe(false)
})

test('several variants use the slowest pair rather than summing traffic from other variants', () => {
  const small = buildStatistic('binomial', { n: 300, sum: 60, sumSquares: 60 })
  const first = remainingPower(input)
  const second = remainingPower({ ...input, variants: [small] })
  expect(remainingPower({ ...input, variants: [b, small] }).daysRemaining)
    .toBe(Math.max(first.daysRemaining!, second.daysRemaining!))
})

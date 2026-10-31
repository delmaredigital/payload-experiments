import { expect, test } from 'vitest'
import { checkSrm } from '@delmaredigital/experiments-stats'
import { exposureSrm } from '../../src/results/srm.js'

test('renormalises frozen weights, includes holdout and agrees with checkSrm', () => {
  const arms = [{ key: 'control', weight: 45 }, { key: 'variantA', weight: 45 }, { key: 'holdout', weight: 10 }]
  const actual = exposureSrm(arms, { control: 450, variantA: 440, holdout: 110 })
  expect(actual).toEqual({ p: checkSrm([450, 440, 110], [45, 45, 10]), flagged: false,
    expected: { control: .45, variantA: .45, holdout: .1 } })
  expect(exposureSrm(arms, { control: 900, variantA: 1, holdout: 99 }).flagged).toBe(true)
})

test('zero-weight arms are omitted; an impossible exposure is flagged', () => {
  const arms = [{ key: 'control', weight: 50 }, { key: 'variantA', weight: 50 }, { key: 'holdout', weight: 0 }]
  expect(exposureSrm(arms, { control: 100, variantA: 100, holdout: 0 }).p).toBe(1)
  expect(exposureSrm(arms, { control: 100, variantA: 100, holdout: 1 }).flagged).toBe(true)
  expect(exposureSrm(arms, {}).p).toBe(1)
})

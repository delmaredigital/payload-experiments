import { expect, test } from 'vitest'
import { buildRegressionAdjustedStatistic, buildStatistic, summarizeUnits, summarizeUnitsWithCovariate } from '@delmaredigital/experiments-stats'
import { outcomeStatistic } from '../../src/results/cuped.js'

test('outcome and covariate moments come directly from stats helpers', () => {
  const values = [1, 3, 5, 7], pre = [0, 2, 4, 6]
  expect(outcomeStatistic('count', values).statistic).toEqual(buildStatistic('count', summarizeUnits(values)))
  expect(outcomeStatistic('revenue', values, pre).statistic)
    .toEqual(buildRegressionAdjustedStatistic('revenue', summarizeUnitsWithCovariate(values, pre)))
})

test('invalid inputs cannot produce an apparently valid statistic', () => {
  expect(() => outcomeStatistic('revenue', [NaN])).toThrow(/finite/)
  expect(() => outcomeStatistic('revenue', [1], [Infinity])).toThrow(/finite/)
  expect(() => outcomeStatistic('revenue', [1, 2], [1])).toThrow(/length/)
  expect(() => outcomeStatistic('binomial', [-1, 2])).toThrow(/0 or 1/)
})

import { expect, it } from 'vitest'
import { checkSrm } from '../../src/diagnostics/srm.js'
import { chi2Sf } from '../../src/internal/gamma.js'

it('returns one for exact splits, including a measured holdout', () => {
  expect(checkSrm([100, 100], [50, 50])).toBe(1)
  expect(checkSrm([450, 450, 100], [45, 45, 10])).toBe(1)
  expect(checkSrm([10, 10, 10, 10, 10], [1, 1, 1, 1, 1])).toBe(1)
})

it('decreases as imbalance grows and retains extremely small p-values', () => {
  let previous = 1
  for (const n of [500, 501, 510, 550, 600, 750, 900, 980]) {
    const p = checkSrm([n, 1000 - n], [50, 50])
    expect(p).toBeLessThanOrEqual(previous)
    expect(p).toBeGreaterThan(0)
    previous = p
  }
})

it('returns one for zero total and is invariant to weight scale', () => {
  expect(checkSrm([0, 0], [50, 50])).toBe(1)
  for (const counts of [[450, 450, 100], [480, 420, 100], [700, 200, 100]]) {
    expect(checkSrm(counts, [45, 45, 10])).toBe(checkSrm(counts, [0.45, 0.45, 0.1]))
  }
})

it('skips zero weights but counts them in upstream degrees of freedom', () => {
  // Expected counts are 150,150. The third arm adds a degree of freedom.
  const statistic = (100 - 150) ** 2 / 150 + (200 - 150) ** 2 / 150
  expect(checkSrm([100, 200, 0], [50, 50, 0])).toBe(chi2Sf(statistic, 2))
  expect(checkSrm([100, 200, 0], [50, 50, 0])).not.toBe(checkSrm([100, 200], [50, 50]))
})

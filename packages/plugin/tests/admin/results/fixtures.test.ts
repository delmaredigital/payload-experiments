import { expect, test } from 'vitest'
import { checkSnapshot, fixture, fixtures, revenueSnapshot } from './fixtures.js'

const names = ['T1', 'T2', 'T3', 'T4', 'T4-stopped', 'T5', 'T6', 'T7', 'T7-adjusted', 'T7-bayesian', 'T7-several', 'T8', 'T9', 'T9-infeasible', 'T10', 'R1', 'R2', 'R3']
test('loads every output fixture, with every verdict row represented', () => {
  expect(Object.keys(fixtures).sort()).toEqual(names.sort())
  expect(new Set(Object.values(fixtures).map(snapshot => snapshot.verdict.row)).size).toBe(13)
})
test.each(names)('%s has every required snapshot field and valid verdict unions', name => {
  expect(() => checkSnapshot(fixture(name))).not.toThrow()
})

test('completeness check rejects deleted required fields at every nesting level', () => {
  const optional = new Set(['unavailable', 'covariate', 'capped', 'historyUnits', 'pValue', 'pValueAdjusted', 'chanceToWin', 'risk', 'guardrailLine'])
  function visit(value: unknown) {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (value === null || typeof value !== 'object') return
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      // Records have arbitrary keys, but their values' own required fields are checked.
      if (!optional.has(key) && !['control', 'variantA', 'variantB', 'variantC', 'holdout', 'gifts', 'registrations', 'completed-lessons'].includes(key)) {
        Reflect.deleteProperty(value, key)
        expect(() => checkSnapshot(snapshot), key).toThrow('Incomplete snapshot')
        Object.defineProperty(value, key, descriptor)
      }
      visit(descriptor.value)
    }
  }
  const snapshot = revenueSnapshot()
  snapshot.contentChanges = [{ at: '2026-10-30', doc: 'page', by: 'editor' }]
  snapshot.metrics[0]!.perArm[0]!.covariate = { preSum: 1, preSumSquares: 1, postPreSumOfProducts: 1 }
  visit(snapshot)
})
test.each([{ row: 11 }, { row: 'T1' }, { code: 'unknown' }])('rejects invalid verdict unions %j', patch => {
  const snapshot = fixture('T7')
  expect(() => checkSnapshot({ ...snapshot, verdict: { ...snapshot.verdict, ...patch } })).toThrow('Incomplete snapshot')
})

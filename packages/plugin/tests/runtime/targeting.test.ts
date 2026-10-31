import { expect, test } from 'vitest'
import { evaluateTargeting } from '../../src/runtime/targeting.js'
import type { TargetingRule } from '../../src/types/contracts.js'

test('rules are AND-ed, typed, case-insensitive for strings, and missing attributes fail even neq/nin', () => {
  const rules: TargetingRule[] = [
    { attribute: 'source', op: 'in', value: ['EMAIL', 'direct'] },
    { attribute: 'age', op: 'gte', value: 18 },
    { attribute: 'loggedIn', op: 'eq', value: true },
  ]
  expect(evaluateTargeting(rules, { source: 'email', age: 20, loggedIn: true })).toBe(true)
  expect(evaluateTargeting(rules, { source: 'email', age: 17, loggedIn: true })).toBe(false)
  expect(evaluateTargeting(rules, { source: 'email', age: '20', loggedIn: true })).toBe(false)
  expect(evaluateTargeting([], {})).toBe(true)
  for (const op of ['eq', 'neq', 'nin'] as const) expect(evaluateTargeting([{ attribute: 'missing', op, value: op === 'nin' ? ['a'] : 'a' }], {})).toBe(false)
  expect(evaluateTargeting([{ attribute: 'toString', op: 'neq', value: 'x' }], {})).toBe(false)
})
test.each([
  ['eq', 'EMAIL', 'email', true], ['neq', 'EMAIL', 'email', false], ['contains', '/courses/one', 'COURSES', true],
  ['nin', 'email', ['direct'], true], ['gt', 3, 2, true], ['gte', 2, 2, true],
  ['lt', 2, 3, true], ['lte', 2, 2, true], ['eq', false, false, true], ['gt', Infinity, 2, false],
] as const)('%s operator on %j', (op, actual, value, expected) => {
  expect(evaluateTargeting([{ attribute: 'a', op, value: Array.isArray(value) ? [...value] : value } as TargetingRule], { a: actual })).toBe(expected)
})
test('declarations constrain types and unknown attributes', () => {
  expect(evaluateTargeting([{ attribute: 'age', op: 'eq', value: '20' }], { age: '20' }, { age: { type: 'number' } })).toBe(false)
  expect(evaluateTargeting([{ attribute: 'age', op: 'eq', value: 20 }], { age: 20 }, {})).toBe(false)
  expect(evaluateTargeting([{ attribute: 'loggedIn', op: 'eq', value: true }], { loggedIn: true }, { loggedIn: { type: 'boolean' } })).toBe(true)
})

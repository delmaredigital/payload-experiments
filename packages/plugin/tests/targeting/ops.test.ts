import { expect, test } from 'vitest'
import { evaluateOp, isOpValid, TARGETING_OPS } from '../../src/targeting/ops.js'
const ops = ['eq', 'neq', 'in', 'nin', 'contains', 'gt', 'gte', 'lt', 'lte']
for (const type of ['string', 'number', 'boolean'] as const) {
  for (const op of ops) {
    test(`${type} × ${op} validity and type checks`, () => {
      expect(isOpValid(type, op)).toBe((TARGETING_OPS[type] as readonly string[]).includes(op))
      expect(evaluateOp(type, op, {}, {})).toBe(false)
      expect(evaluateOp(type, op, undefined, undefined)).toBe(false)
      expect(evaluateOp(type, op, null, null)).toBe(false)
      const actual = { string: 'abc', number: 1, boolean: true }[type]
      expect(evaluateOp(type, op, actual, {})).toBe(false)
      if (!isOpValid(type, op)) expect(evaluateOp(type, op, actual, actual)).toBe(false)
    })
  }
}
test.each([
  ['eq', 'HELLO', 'hello', true], ['eq', 'hello', 'other', false],
  ['neq', 'HELLO', 'hello', false], ['neq', 'hello', 'other', true],
  ['contains', 'Hello WORLD', 'world', true], ['contains', 'hello', 'x', false],
  ['in', 'HELLO', ['other', 'hello'], true], ['in', 'hello', ['other'], false],
  ['nin', 'HELLO', ['hello'], false], ['nin', 'hello', ['other'], true],
  ['in', 'hello', 'hello', false], ['nin', 'hello', 'hello', false],
  ['in', 'hello', ['hello', 1], false], ['nin', 'hello', [1], false],
  ['in', 'hello', [], false], ['nin', 'hello', [], true],
])('string %s %j %j', (op, actual, expected, result) => {
  expect(evaluateOp('string', op, actual, expected)).toBe(result)
})
test.each([
  ['eq', 2, 2, true], ['eq', 2, 3, false], ['neq', 2, 3, true], ['neq', 2, 2, false],
  ['gt', 3, 2, true], ['gt', 2, 2, false], ['gte', 2, 2, true], ['gte', 1, 2, false],
  ['lt', 1, 2, true], ['lt', 2, 2, false], ['lte', 2, 2, true], ['lte', 3, 2, false],
])('number %s %j %j', (op, actual, expected, result) => {
  expect(evaluateOp('number', op, actual, expected)).toBe(result)
})
test('booleans and unknown/mismatched types', () => {
  expect(evaluateOp('boolean', 'eq', false, false)).toBe(true)
  expect(evaluateOp('boolean', 'eq', true, false)).toBe(false)
  expect(evaluateOp('boolean', 'eq', true, 'true')).toBe(false)
  expect(evaluateOp('number', 'eq', 2, '2')).toBe(false)
  expect(evaluateOp('number', 'eq', NaN, NaN)).toBe(false)
  expect(evaluateOp('number', 'eq', Infinity, Infinity)).toBe(false)
  expect(evaluateOp('unknown', 'eq', 1, 1)).toBe(false)
  expect(isOpValid('toString', 'eq')).toBe(false)
  expect(isOpValid('string', 'unknown')).toBe(false)
  expect(evaluateOp('string', 'unknown', 'a', 'a')).toBe(false)
})

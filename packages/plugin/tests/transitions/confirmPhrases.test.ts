import { expect, test } from 'vitest'
import { expectedConfirm, matchesConfirm } from '../../src/transitions/confirmPhrases.js'
test('exact confirmation phrases', () => {
  expect(expectedConfirm('decide', 'Variant A')).toBe('Variant A')
  expect(expectedConfirm('discard', 'Variant A')).toBe('discard winner')
  expect(expectedConfirm('hard-coded', 'Variant A')).toBe('the developer has hard-coded Variant A')
})
test('trimmed comparison is case sensitive and null safe', () => {
  expect(matchesConfirm(' Variant A ', '\tVariant A\n')).toBe(true)
  expect(matchesConfirm('Variant A', 'variant A')).toBe(false)
  expect(matchesConfirm('Variant A', 'Variant  A')).toBe(false)
  expect(matchesConfirm('', null)).toBe(false)
  expect(matchesConfirm('', undefined)).toBe(false)
  expect(matchesConfirm('', ' ')).toBe(true)
})

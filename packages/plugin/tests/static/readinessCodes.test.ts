import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { ReadinessCode } from '../../src/transitions/checkStart.js'

const codes = [
  'weights-total', 'control-count', 'control-first', 'holdout-count', 'holdout-last', 'variant-count',
  'invalid-key', 'duplicate-key', 'slot-required', 'duplicate-slot',
  'invalid-status', 'no-planned-duration', 'no-primary-metric', 'no-reach-per-day', 'page-no-targets', 'page-target-unpublished', 'page-targets-unchecked', 'page-user-unit',
  'flag-no-point', 'flag-params-invalid', 'flag-point-busy', 'flag-placement-missing', 'no-placements', 'empty-slot', 'make-content-unsupported',
  'layer-unit-mismatch', 'layer-full', 'unknown-metric-source', 'unit-source-mismatch', 'undeclared-targeting-key', 'invalid-targeting-rule',
] as const satisfies readonly ReadinessCode[]
// Also fail compilation if the public union grows beyond the hand-maintained list.
const exhaustive: Record<Exclude<ReadinessCode, typeof codes[number]>, never> = {} satisfies Record<Exclude<ReadinessCode, typeof codes[number]>, never>

test('ReadinessCode lists exactly the literal predicates and ARM_CHECK_ORDER (31)', () => {
  const source = readFileSync(new URL('../../src/transitions/checkStart.ts', import.meta.url), 'utf8')
  const literals = [...source.matchAll(/\badd\('([^']+)'/g)].map(match => match[1])
  const order = source.match(/ARM_CHECK_ORDER[^=]*=\s*\[([\s\S]*?)\]/)![1]!
  const arms = [...order.matchAll(/'([^']+)'/g)].map(match => match[1])
  expect(literals).toHaveLength(21)
  expect(arms).toHaveLength(10)
  expect(new Set([...literals, ...arms])).toEqual(new Set(codes))
  expect(new Set(codes).size).toBe(31)
  expect(exhaustive).toEqual({})
})

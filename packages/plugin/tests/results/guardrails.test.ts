import { describe, expect, test } from 'vitest'
import { guardrailStatus, type GuardrailInput } from '../../src/results/guardrails.js'

function example(method: GuardrailInput['method'], direction: GuardrailInput['direction'], status: string): GuardrailInput {
  const cases = {
    failing: { lowerBound: -0.2, upperBound: -0.08, pointEstimate: -0.12, pWorse: 0.95 },
    ok: { lowerBound: -0.04, upperBound: 0.1, pointEstimate: -0.01, pWorse: 0.75 },
    warning: { lowerBound: -0.1, upperBound: 0.03, pointEstimate: -0.04, pWorse: 0.70 },
    insufficient: { lowerBound: -0.1, upperBound: 0.1, pointEstimate: 0, pWorse: 0.69 },
  }
  const values = cases[status as keyof typeof cases]
  return {
    method, direction, n: 150, minSampleSize: 150, threshold: 0.05, ...values,
    ...(direction === 'decrease' ? {
      lowerBound: -values.upperBound, upperBound: -values.lowerBound, pointEstimate: -values.pointEstimate,
    } : {}),
  }
}

for (const method of ['sequential', 'bayesian'] as const) {
  for (const direction of ['increase', 'decrease'] as const) {
    describe(`${method}, ${direction}`, () => {
      test.each(['failing', 'ok', 'warning', 'insufficient'])('%s', status => {
        expect(guardrailStatus(example(method, direction, status))).toBe(status)
      })
      test('failing is impossible below its own sample minimum', () => {
        const value = example(method, direction, 'failing')
        value.n = 149
        expect(guardrailStatus(value)).toBe('warning')
      })
      test('failing takes priority over ok, and ok over warning', () => {
        const value = example(method, direction, 'failing')
        // A small but clearly negative effect can also rule out the larger harm threshold.
        Object.assign(value, direction === 'decrease'
          ? { lowerBound: 0.01, upperBound: 0.04 }
          : { lowerBound: -0.04, upperBound: -0.01 })
        expect(guardrailStatus(value)).toBe('failing')
        value.n = 149
        expect(guardrailStatus(value)).toBe('ok')
      })
      test('a bound equal to the tolerated harm is not ok', () => {
        const value = example(method, direction, 'warning')
        if (direction === 'decrease') value.upperBound = 0.05
        else value.lowerBound = -0.05
        expect(guardrailStatus(value)).toBe('warning')
      })
      test('null bounds do not establish safety or sequential failure', () => {
        const value = example(method, direction, 'insufficient')
        value.lowerBound = value.upperBound = null
        expect(guardrailStatus(value)).toBe('insufficient')
      })
    })
  }
}

test('sequential harm requires a strict bound beyond zero', () => {
  const value = example('sequential', 'increase', 'failing')
  value.upperBound = 0
  expect(guardrailStatus(value)).toBe('warning')
})

test('Bayesian probability boundaries and missing probability', () => {
  const value = example('bayesian', 'increase', 'failing')
  value.pWorse = 0.9499
  expect(guardrailStatus(value)).toBe('warning')
  value.pWorse = 0.6999
  expect(guardrailStatus(value)).toBe('insufficient')
  delete value.pWorse
  expect(guardrailStatus(value)).toBe('insufficient')
})

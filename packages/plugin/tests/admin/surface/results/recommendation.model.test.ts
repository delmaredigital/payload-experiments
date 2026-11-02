import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { VerdictCode } from '../../../../src/types/snapshot.js'
import { RECOMMENDATION, recommendation } from '../../../../src/admin/surface/results/recommendation.model.js'
import { computeVerdict, type VerdictInput } from '../../../../src/results/verdict.js'
import { fixture, phaseFor } from '../../results/fixtures.js'

function verdictInput(name: string): VerdictInput {
  return JSON.parse(readFileSync(new URL(`../../../_fixtures/snapshots/inputs/${name}.json`, import.meta.url), 'utf8')) as VerdictInput
}

const cases: Record<VerdictCode, [string, string]> = {
  unavailable: ['T1', "Results aren't available right now. Recompute, and ask a developer if it keeps happening."],
  'data-problem': ['T2', 'Stop: the data looks unbalanced, check the setup.'],
  'guardrail-failing': ['T3', 'Stop: Shorter form is making Completed lessons worse.'],
  collecting: ['T4', 'Too early to tell. About 24,000 more people needed to be sure.'],
  'original-better': ['T5', 'The Original is best. Keep the Original.'],
  'worse-none-better': ['T6', 'No version beats the Original, and Shorter form does worse. Keep the Original.'],
  winner: ['T7', 'Shorter form is most likely to be best.'],
  mixed: ['T8', 'Mixed: Shorter form does better, One page form does worse. Review before deciding.'],
  'keep-running': ['T9', 'No difference so far. Keep running until Nov 13, 2026.'],
  'no-difference': ['T10', 'No difference found. Keep the Original, or test a bigger change.'],
  'rollout-collecting': ['R2', 'Since shipping Shorter form: still collecting data.'],
  'rollout-readout': ['R3', 'Since shipping Shorter form: +12.0% compared with the holdout.'],
}
test('every source union member has a recommendation row and a fixture case', () => {
  const source = readFileSync(new URL('../../../../src/types/snapshot.ts', import.meta.url), 'utf8')
  const union = source.match(/export type VerdictCode = ([^\n]+)/)![1]!
  const codes = [...union.matchAll(/'([^']+)'/g)].map(match => match[1]).sort()
  expect(Object.keys(RECOMMENDATION).sort()).toEqual(codes)
  expect(Object.keys(cases).sort()).toEqual(codes)
})
test.each(Object.entries(cases))('%s uses its snapshot and stored round labels', (code, [name, expected]) => {
  const snapshot = fixture(name)
  expect(snapshot.verdict.code).toBe(code)
  expect(recommendation({ snapshot, phase: phaseFor(snapshot), plannedDurationDays: 28 })).toBe(expected)
})
test('null sample requirement keeps collecting without inventing an estimate', () => {
  const snapshot = fixture('T4')
  snapshot.power.exposuresNeededPerArm = null
  expect(recommendation({ snapshot, phase: phaseFor(snapshot) })).toBe('Too early to tell. Keep it running.')
})
test('unknown duration or start omits the planned end date', () => {
  const snapshot = fixture('T9'), phase = phaseFor(snapshot)
  for (const ctx of [{ snapshot, phase }, { snapshot, plannedDurationDays: 28 }, { snapshot, phase, plannedDurationDays: NaN }]) {
    expect(recommendation(ctx)).toBe('No difference so far. Keep running.')
  }
})
test('compared groups exclude holdout, counts round and format, and missing labels use fixed names', () => {
  const snapshot = fixture('T4'), phase = phaseFor(snapshot)
  snapshot.power.exposuresNeededPerArm = 1234.7
  expect(recommendation({ snapshot, phase })).toBe('Too early to tell. About 2,469 more people needed to be sure.')
  const winning = fixture('T7')
  expect(recommendation({ snapshot: winning })).toBe('Variant A is most likely to be best.')
  const historical = phaseFor(winning)
  historical.arms.find(arm => arm.key === 'variantA')!.label = 'Old saved label'
  expect(recommendation({ snapshot: winning, phase: historical })).toBe('Old saved label is most likely to be best.')
})

test('guardrail harm uses the stored failing-group finding, independent of two-sided significance and arm order', () => {
  const snapshot = fixture('T3'), phase = phaseFor(snapshot)
  delete snapshot.verdict.worstArm // Older snapshots only stored the finding sentence.
  const metric = snapshot.metrics.find(metric => metric.role === 'guardrail')!
  // One-sided failure can coexist with a two-sided interval crossing zero.
  metric.comparisons[0]!.significant = 'none'
  expect(recommendation({ snapshot, phase })).toBe('Stop: Shorter form is making Completed lessons worse.')
  // An earlier comparison can be worse but below its converter minimum.
  phase.arms.splice(2, 0, { key: 'variantB', kind: 'variant', label: 'One page form' })
  metric.comparisons[0]!.significant = 'worse'
  metric.comparisons.push({ ...metric.comparisons[0]!, arm: 'variantB', significant: 'none' })
  snapshot.verdict.finding = 'Stop: One page form harms Completed lessons.'
  expect(recommendation({ snapshot, phase })).toBe('Stop: One page form is making Completed lessons worse.')
})

test('real guardrail verdict names the harmed variant by its saved label', () => {
  const input = verdictInput('T3')
  input.guardrails = [{ name: 'Completed lessons', status: 'failing', worstArmLabel: 'Simpler signup', worstArm: 'variantA' }]
  const snapshot = fixture('T3'), phase = phaseFor(snapshot)
  phase.arms.find(arm => arm.kind === 'variant')!.label = 'Simpler signup'
  snapshot.verdict = computeVerdict(input)
  expect(snapshot.verdict.code).toBe('guardrail-failing')
  expect(recommendation({ snapshot, phase })).toBe('Stop: Simpler signup is making Completed lessons worse.')
})

test.each(['T6', 'T8'])('%s skips worse holdout and control comparisons ahead of the harmful variant', name => {
  const snapshot = fixture(name), phase = phaseFor(snapshot)
  const primary = snapshot.metrics.find(metric => metric.role === 'primary')!
  const harmful = primary.comparisons.find(comparison => comparison.significant === 'worse')!
  primary.comparisons.unshift({ ...harmful, arm: 'holdout' }, { ...harmful, arm: 'control' })
  expect(recommendation({ snapshot, phase })).toBe(cases[snapshot.verdict.code][1])
})

test.each([
  { daysRemaining: 91, feasible: true },
  { daysRemaining: 2, feasible: false },
])('real long-duration verdict uses the bigger-change sentence (%j)', power => {
  const input = verdictInput('T9')
  input.power = power
  const snapshot = fixture('T9')
  snapshot.power = { ...snapshot.power, ...power }
  snapshot.verdict = computeVerdict(input)
  expect(snapshot.verdict.code).toBe('keep-running')
  expect(recommendation({ snapshot, phase: phaseFor(snapshot), plannedDurationDays: 28 })).toBe(
    'No clear difference, and a clear answer would take more than 3 months at this traffic. Consider a bigger change.')
})

test('real stopped collecting verdict asks for no more people', () => {
  const input = verdictInput('T4')
  input.status = 'stopped'
  const snapshot = fixture('T4')
  snapshot.verdict = computeVerdict(input)
  expect(snapshot.verdict.code).toBe('collecting')
  expect(recommendation({ snapshot, phase: phaseFor(snapshot), status: input.status })).toBe('Stopped before enough people took part to tell.')
})

test('stored worstArm takes precedence over the legacy finding match', () => {
  const snapshot = fixture('T3'), phase = phaseFor(snapshot)
  phase.arms.push({ key: 'variantB', kind: 'variant', label: 'Longer form' })
  snapshot.verdict.worstArm = 'variantB'
  expect(recommendation({ snapshot, phase })).toBe('Stop: Longer form is making Completed lessons worse.')
})

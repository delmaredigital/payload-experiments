import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, expectTypeOf, test } from 'vitest'
import { computeVerdict, type VerdictInput } from '../../src/results/verdict.js'
import type { Snapshot } from '../../src/types/snapshot.js'
import { collectImports } from '../_helpers/importGraph.js'

const fixtures = new URL('../_fixtures/snapshots/', import.meta.url)
const names = readdirSync(fixtures).filter(name => name.endsWith('.json')).sort()
function input(name = 'T7'): VerdictInput {
  const value: VerdictInput = JSON.parse(readFileSync(new URL(`inputs/${name}.json`, fixtures), 'utf8'))
  // The shared legacy inputs describe higher-is-better metrics.
  value.primary.direction = 'increase'
  return value
}
function snapshot(name: string): Snapshot {
  const value: Snapshot = JSON.parse(readFileSync(new URL(`${name}.json`, fixtures), 'utf8'))
  return value
}

test('rollout winner and failing guardrail labels are required by the contract', () => {
  type Rollout = Extract<VerdictInput, { phaseKind: 'rollout' }>
  expectTypeOf<Rollout>().toExtend<{ winnerArm: string; winnerLabel: string }>()
  expectTypeOf<Omit<Rollout, 'winnerArm'>>().not.toExtend<VerdictInput>()
  expectTypeOf<Omit<Rollout, 'winnerLabel'>>().not.toExtend<VerdictInput>()
  expectTypeOf<VerdictInput['primary']['direction']>().toEqualTypeOf<'increase' | 'decrease'>()
  expectTypeOf<Omit<VerdictInput['primary'], 'direction'>>().not.toExtend<VerdictInput['primary']>()
  type Guardrail = VerdictInput['guardrails'][number]
  expectTypeOf<{ name: string; status: 'failing' }>().not.toExtend<Guardrail>()
})

test('every JSON snapshot and input satisfies its complete contract', () => {
  // JSON imports widen strings and tuples. Compile the actual JSON literals with
  // satisfies instead of casting away those checks or duplicating the fixtures.
  const virtualFile = fileURLToPath(new URL('./fixture-contracts.ts', import.meta.url))
  const source = [
    "import type { Snapshot } from '../../src/types/snapshot.js'",
    "import type { VerdictInput } from '../../src/results/verdict.js'",
    ...names.flatMap((name, index) => [
      `const snapshot${index} = ${readFileSync(new URL(name, fixtures), 'utf8').trimEnd()} satisfies Snapshot;`,
      `const input${index} = ${JSON.stringify(input(name.slice(0, -5)))} satisfies VerdictInput;`,
    ]),
  ].join('\n')
  const configPath = fileURLToPath(new URL('../../tsconfig.test.json', import.meta.url))
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fileURLToPath(new URL('../../', import.meta.url)))
  const host = ts.createCompilerHost(parsed.options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === virtualFile
    ? ts.createSourceFile(file, source, languageVersion, true)
    : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([virtualFile], parsed.options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  expect(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => '\n',
  })).toBe('')
}, 30_000)

describe('shared admin fixtures', () => {
  test.each(names)('%s matches the stored verdict exactly', name => {
    const stored = snapshot(name.slice(0, -5))
    const value = input(name.slice(0, -5))
    const verdict = computeVerdict(value)
    expect(verdict).toEqual(stored.verdict)
    expect(verdict.headline).toBe(verdict.finding + (verdict.action ? ` ${verdict.action}` : ''))
    expect([verdict.finding, verdict.action, verdict.detail, verdict.guardrailLine].filter(Boolean).join(' '))
      .not.toMatch(/\b(arms?|phases?)\b/i)
    expect(stored.params.cupedLookbackDays).toBe(14)
    expect(stored.params.bayesian).toEqual({ ctw: 0.95, risk: 0.0125 })
    const primary = stored.metrics.find(metric => metric.role === 'primary')!
    const control = primary.perArm.find(group => group.arm === value.controlArm)!
    for (const comparison of primary.comparisons) {
      const treatment = primary.perArm.find(group => group.arm === comparison.arm)!
      expect(comparison.lift).toBeCloseTo((treatment.mean - control.mean) / control.mean, 12)
    }
    expect(value.primary.convertersPerArm).toEqual(primary.perArm.map(group => ({
      arm: group.arm, converters: group.converters,
      kind: value.exposures.perArm.find(exposure => exposure.arm === group.arm)!.kind,
    })))
    expect(value.primary.comparisons.map(comparison => comparison.ci)).toEqual(primary.comparisons.map(comparison => comparison.ciAdjusted))
    for (const group of primary.perArm) {
      expect(group.mean).toBe(group.sum / group.n)
      expect(group.n).toBe(stored.exposures.perArm[group.arm])
    }
  })

  test('covers each row and its recommended choice', () => {
    const recommendations: Record<string, string | null> = {
      T1: null, T2: null, T3: 'control', T4: null, T5: 'control', T6: 'control',
      T7: 'variantA', T8: 'variantA', T9: null, T10: 'control', R1: null, R2: null, R3: null,
    }
    for (const [name, recommendation] of Object.entries(recommendations)) {
      expect(computeVerdict(input(name)).recommendedArm).toBe(recommendation)
    }
  })
})

test('first match: unavailable, data problem, failing guardrail, collecting, significance', () => {
  const value = input('T3')
  value.primary.unavailable = 'Offline'
  value.srm.flagged = true
  value.exposures.perArm[0]!.n = 1
  value.primary.comparisons[0]!.significant = 'better'
  expect(computeVerdict(value).row).toBe(1)
  delete value.primary.unavailable
  expect(computeVerdict(value).row).toBe(2)
  value.srm.flagged = false
  expect(computeVerdict(value).row).toBe(3)
  value.guardrails = []
  expect(computeVerdict(value).row).toBe(4)
})

test.each([
  ['T3', 3, 'variantA'], ['T6', 6, 'variantA'], ['T8', 8, 'variantB'],
] as const)('%s carries the worse version key for row %s', (name, row, worstArm) => {
  expect(computeVerdict(input(name))).toMatchObject({ row, worstArm })
})

test('row 6 carries the first worse version in the sentence, even when another has a larger decline', () => {
  const value = input('T6')
  addVariant(value, 'variantC', 'One-page form', 'worse', -.5)
  expect(computeVerdict(value)).toMatchObject({ row: 6, worstArm: 'variantA' })
  value.primary.comparisons.reverse()
  expect(computeVerdict(value)).toMatchObject({ row: 6, worstArm: 'variantC' })
})

test.each(names.filter(name => !['T3.json', 'T6.json', 'T8.json'].includes(name)))('%s omits worstArm for other verdict rows', name => {
  expect(computeVerdict(input(name.slice(0, -5)))).not.toHaveProperty('worstArm')
})

test.each([0.01, 0.02])('same-person multiple versions at share %s is a data problem', share => {
  const value = input()
  value.exposures.multiArmShare = share
  expect(computeVerdict(value).row).toBe(2)
  expect(computeVerdict({ ...value, phaseKind: 'rollout', winnerArm: 'variantA', winnerLabel: 'Shorter form' })).toMatchObject({ row: 'R1', code: 'data-problem' })
})

test('multiple-version share below one percent does not override a winner', () => {
  const value = input()
  value.exposures.multiArmShare = 0.0099
  expect(computeVerdict(value).row).toBe(7)
})

test('holdout is excluded from the collecting minimum', () => {
  const value = input()
  value.exposures.perArm.find(item => item.kind === 'holdout')!.n = 0
  expect(computeVerdict(value).row).toBe(7)
  value.exposures.perArm[1]!.n = 999
  expect(computeVerdict(value).finding).toBe(`Collecting data: 999 of 1000 people, ${Math.min(...value.primary.convertersPerArm.filter(group => group.kind !== 'holdout').map(group => group.converters))} of 150 conversions.`)
})

test.each(['T5', 'T6', 'T7', 'T8'])('holdout comparisons cannot alter %s', name => {
  const value = input(name)
  const expected = computeVerdict(value)
  for (const significant of ['better', 'worse', 'none'] as const) {
    value.primary.comparisons.push({ arm: 'holdout', label: 'Holdout', significant, lift: 10, ci: [1, 20] })
    expect(computeVerdict(value)).toEqual(expected)
  }
})

test('conversion minimum alone collects, with stopped wording', () => {
  const value = input()
  value.primary.convertersPerArm[0]!.converters = 149
  value.status = 'stopped'
  expect(computeVerdict(value)).toMatchObject({ row: 4, finding: 'Stopped before enough data was collected.' })
})

test('conversion minimum is per group, even when the total exceeds the minimum', () => {
  const value = input()
  value.primary.convertersPerArm[0]!.converters = 149
  expect(computeVerdict(value)).toMatchObject({
    row: 4, finding: 'Collecting data: 1980 of 1000 people, 149 of 150 conversions.',
  })
  value.primary.convertersPerArm[0]!.converters = 150
  value.primary.convertersPerArm.find(group => group.kind === 'holdout')!.converters = 0
  expect(computeVerdict(value).row).toBe(7)
})

test('meeting both minimums allows a result', () => {
  const value = input()
  for (const group of value.primary.convertersPerArm) group.converters = value.primary.minSampleSize
  for (const group of value.exposures.perArm) group.n = value.exposures.minExposuresPerArm
  expect(computeVerdict(value).row).toBe(7)
})

test('a stopped inconclusive result recommends the Original', () => {
  const value = input('T9')
  value.status = 'stopped'
  expect(computeVerdict(value)).toMatchObject({ row: 10, recommendedArm: 'control', action: null })
})

test('days round up; 90 is feasible, over 90 and infeasible use the long-duration wording', () => {
  const value = input('T9')
  value.power.daysRemaining = 6.2
  expect(computeVerdict(value).action).toBe('Keep running about 7 days.')
  value.power.daysRemaining = 1
  expect(computeVerdict(value).action).toBe('Keep running about 1 days.')
  value.power.daysRemaining = 90
  expect(computeVerdict(value).action).toBe('Keep running about 90 days.')
  value.power.daysRemaining = 90.01
  expect(computeVerdict(value).headline).toBe(snapshot('T9-infeasible').verdict.headline)
  value.power = { daysRemaining: 2, feasible: false }
  expect(computeVerdict(value).headline).toBe(snapshot('T9-infeasible').verdict.headline)
})

test.each([0, null])('unknown/already-sufficient estimate %s runs to the planned end date', daysRemaining => {
  const value = input('T9')
  value.power = { daysRemaining, feasible: true }
  expect(computeVerdict(value)).toMatchObject({ finding: 'No clear winner yet.', action: 'Keep running to the planned end date.' })
  expect(computeVerdict(value).headline).not.toContain('0 days')
  value.power.feasible = false
  expect(computeVerdict(value).headline).toBe(snapshot('T9-infeasible').verdict.headline)
})

test.each(['T7', 'T7-adjusted'])('%s quotes its multiplicity-adjusted CI', name => {
  const stored = snapshot(name)
  const value = input(name)
  expect(stored.k).toBeGreaterThanOrEqual(2)
  expect(stored.metrics[0]!.comparisons[0]!.ci).not.toEqual(stored.metrics[0]!.comparisons[0]!.ciAdjusted)
  expect(computeVerdict(value).finding).toBe(name === 'T7'
    ? 'Shorter form is statistically better: +12% (CI +1% to +23%).'
    : 'Shorter form is statistically better: +12% (CI +1% to +24%).')
})

test.each([
  [0.978, ' (97%)'], [0.99499, ' (99%)'], [0.995, ' (more than 99%)'],
  [0.996, ' (more than 99%)'], [1, ' (more than 99%)'], [undefined, ''],
] as const)('chance to win %s does not imply certainty', (chanceToWin, suffix) => {
  const value = input('T7-bayesian')
  value.primary.comparisons[0]!.chanceToWin = chanceToWin
  expect(computeVerdict(value).finding).toBe(`Shorter form is very likely better${suffix}.`)
})

test('percentages are signed, rounded, and unbounded limits use an ellipsis', () => {
  const value = input()
  Object.assign(value.primary.comparisons[0]!, { lift: 0.124, ci: [null, 0.216] })
  expect(computeVerdict(value).finding).toBe('Shorter form is statistically better: +12% (CI … to +22%).')
  const rollout: VerdictInput = { ...value, phaseKind: 'rollout', winnerArm: 'variantA', winnerLabel: 'Shorter form' }
  rollout.exposures.perArm.find(item => item.kind === 'holdout')!.n = 1000
  rollout.primary.convertersPerArm.find(item => item.kind === 'holdout')!.converters = 150
  Object.assign(value.primary.comparisons[0]!, { lift: -0.124, ci: [-0.216, null] })
  expect(computeVerdict(rollout).finding).toBe('Since shipping Shorter form: -12% vs the holdout (CI -22% to …).')
})

test('several better variants recommend the largest lift, independently of comparison order', () => {
  const value = input('T7-several')
  expect(computeVerdict(value).recommendedArm).toBe('variantB')
  value.primary.comparisons.reverse()
  expect(computeVerdict(value)).toEqual(snapshot('T7-several').verdict)
})

function addVariant(value: VerdictInput, arm: string, label: string, significant: 'better' | 'worse' | 'none', lift: number) {
  value.exposures.perArm.push({ arm, label, kind: 'variant', n: 2000 })
  value.primary.convertersPerArm.push({ arm, kind: 'variant', converters: 800 })
  value.primary.comparisons.push({ arm, label, significant, lift, ci: [lift - .1, lift + .1] })
}

test('three better variants say all three and still recommend the greatest lift', () => {
  const value = input('T7-several')
  addVariant(value, 'variantC', 'One-page form', 'better', .3)
  expect(computeVerdict(value)).toMatchObject({
    finding: 'All 3 variants beat the Original; not tested against each other — One-page form has the larger improvement.',
    recommendedArm: 'variantC',
  })
})

test('rows 6 and 8 name every worse and better variant', () => {
  const value = input('T6')
  addVariant(value, 'variantC', 'One-page form', 'worse', -.2)
  expect(computeVerdict(value)).toMatchObject({
    row: 6, finding: 'Shorter form and One-page form are worse; no variant is better.',
    action: 'Decide for the Original or restart without them.',
  })
  value.primary.comparisons.find(comparison => comparison.arm === 'variantB')!.significant = 'better'
  expect(computeVerdict(value)).toMatchObject({
    row: 8, finding: 'Mixed: Guided form better, Shorter form and One-page form worse.',
  })
  value.primary.comparisons[0]!.significant = 'better'
  expect(computeVerdict(value)).toMatchObject({
    row: 8, finding: 'Mixed: Shorter form and Guided form better, One-page form worse.',
  })
})

test.each(['T7', 'R3'])('%s guardrail warnings win over insufficient data', name => {
  const value = input(name)
  expect(computeVerdict(value).guardrailLine).toBe('No harm detected so far')
  value.guardrails.push({ name: 'Donations', status: 'insufficient' })
  expect(computeVerdict(value).guardrailLine).toBe('Too little data to rule out harm')
  value.guardrails.push({ name: 'Completed lessons', status: 'warning' })
  expect(computeVerdict(value).guardrailLine).toBe('Watch Completed lessons: trending worse.')
})

test.each(['T7', 'R3'])('%s omits the guardrailLine property when nothing was checked', name => {
  const value = input(name)
  value.guardrails = []
  expect(computeVerdict(value)).not.toHaveProperty('guardrailLine')
})

test.each(['warning', 'insufficient'] as const)('confirmed rollout harm takes priority over %s', status => {
  const value = input('R3')
  value.guardrails = [
    { name: 'Donations', status },
    { name: 'Completed lessons', status: 'failing', worstArmLabel: 'Shorter form', worstArm: 'variantA' },
  ]
  expect(computeVerdict(value).guardrailLine).toBe('Harm detected: Completed lessons is worse since shipping.')
})

test('rollout minimum includes the holdout and conversions, and failing guardrails do not become test verdicts', () => {
  const value = input('R3')
  value.guardrails[0] = { name: 'Completed lessons', status: 'failing', worstArmLabel: 'Shorter form', worstArm: 'variantA' }
  expect(computeVerdict(value)).toMatchObject({ row: 'R3', guardrailLine: 'Harm detected: Completed lessons is worse since shipping.' })
  value.exposures.perArm.find(item => item.kind === 'holdout')!.n = 999
  expect(computeVerdict(value).row).toBe('R2')
  value.exposures.perArm.find(item => item.kind === 'holdout')!.n = 1000
  value.primary.convertersPerArm[0]!.converters = 149
  expect(computeVerdict(value)).toMatchObject({ row: 'R2',
    finding: 'Since shipping Shorter form: collecting data (1000 of 1000 people, 149 of 150 conversions).',
  })
  value.primary.convertersPerArm[0]!.converters = 150
  value.primary.convertersPerArm.find(group => group.kind === 'holdout')!.converters = 149
  expect(computeVerdict(value).row).toBe('R2')
})

test('rollout reads the explicitly shipped winner, not an earlier unrelated comparison', () => {
  const value = input('R3')
  value.primary.comparisons.unshift({ arm: 'variantB', label: 'Guided form', significant: 'none', lift: -.2, ci: [-.4, 0] })
  expect(computeVerdict(value)).toEqual(snapshot('R3').verdict)
})

test('pure helpers have no runtime dependency edges', () => {
  for (const name of ['verdict', 'guardrails', 'decideGuard']) {
    const graph = collectImports(fileURLToPath(new URL(`../../src/results/${name}.ts`, import.meta.url)))
    expect(graph.bare).toEqual([])
    expect(graph.dynamic).toEqual([])
  }
})

test.each(['sequential', 'bayesian'] as const)('%s recommends the larger improvement for both metric directions in rows 7 and 8', method => {
  for (const direction of ['increase', 'decrease'] as const) {
    const value = input('T7-several')
    value.method = method
    value.primary.direction = direction
    const sign = direction === 'decrease' ? -1 : 1
    value.primary.comparisons = [
      { arm: 'variantA', label: 'Shorter form', significant: 'better', lift: sign * .2, ci: direction === 'decrease' ? [-.3, -.1] : [.1, .3] },
      { arm: 'variantB', label: 'Guided form', significant: 'better', lift: sign * .52, ci: direction === 'decrease' ? [-.62, -.42] : [.42, .62] },
    ]
    expect(computeVerdict(value)).toMatchObject({ row: 7, recommendedArm: 'variantB',
      finding: 'Both beat the Original; not tested against each other — Guided form has the larger improvement.' })
    addVariant(value, 'variantC', 'One-page form', 'worse', -sign * .1)
    const before = structuredClone(value)
    expect(computeVerdict(value)).toMatchObject({ row: 8, recommendedArm: 'variantB' })
    expect(value).toEqual(before)
    value.primary.comparisons.reverse()
    expect(computeVerdict(value).recommendedArm).toBe('variantB')
  }
})

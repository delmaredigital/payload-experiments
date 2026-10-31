import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import { computeVerdict, type VerdictInput } from '../../src/results/verdict.js'
import type { Snapshot } from '../../src/types/snapshot.js'
import { collectImports } from '../_helpers/importGraph.js'

const fixtures = new URL('../_fixtures/snapshots/', import.meta.url)
const names = readdirSync(fixtures).filter(name => name.endsWith('.json')).sort()
function input(name = 'T7'): VerdictInput {
  return JSON.parse(readFileSync(new URL(`inputs/${name}.json`, fixtures), 'utf8'))
}
function snapshot(name: string): Snapshot {
  return JSON.parse(readFileSync(new URL(`${name}.json`, fixtures), 'utf8'))
}

test('every JSON snapshot and input satisfies its complete contract', () => {
  // JSON imports widen strings and tuples. Compile the actual JSON literals with
  // satisfies instead of casting away those checks or duplicating the fixtures.
  const virtualFile = fileURLToPath(new URL('./fixture-contracts.ts', import.meta.url))
  const source = [
    "import type { Snapshot } from '../../src/types/snapshot.js'",
    "import type { VerdictInput } from '../../src/results/verdict.js'",
    ...names.flatMap((name, index) => [
      `const snapshot${index} = ${readFileSync(new URL(name, fixtures), 'utf8').trimEnd()} satisfies Snapshot;`,
      `const input${index} = ${readFileSync(new URL(`inputs/${name}`, fixtures), 'utf8').trimEnd()} satisfies VerdictInput;`,
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
    const compared = new Set(value.exposures.perArm
      .filter(group => value.phaseKind === 'rollout' || group.kind !== 'holdout').map(group => group.arm))
    expect(primary.perArm.filter(group => compared.has(group.arm)).reduce((sum, group) => sum + group.converters, 0))
      .toBe(value.primary.converters)
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

test.each([0.01, 0.02])('same-person multiple versions at share %s is a data problem', share => {
  const value = input()
  value.exposures.multiArmShare = share
  expect(computeVerdict(value).row).toBe(2)
  value.phaseKind = 'rollout'
  expect(computeVerdict(value)).toMatchObject({ row: 'R1', code: 'data-problem' })
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
  expect(computeVerdict(value).finding).toBe(`Collecting data: 999 of 1000 people, ${value.primary.converters} of 150 conversions.`)
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
  value.primary.converters = 149
  value.status = 'stopped'
  expect(computeVerdict(value)).toMatchObject({ row: 4, finding: 'Stopped before enough data was collected.' })
})

test('meeting both minimums allows a result', () => {
  const value = input()
  value.primary.converters = value.primary.minSampleSize
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
  value.power.daysRemaining = 90
  expect(computeVerdict(value).action).toBe('Keep running about 90 days.')
  value.power.daysRemaining = 90.01
  expect(computeVerdict(value).headline).toBe(snapshot('T9-infeasible').verdict.headline)
  value.power = { daysRemaining: 2, feasible: false }
  expect(computeVerdict(value).headline).toBe(snapshot('T9-infeasible').verdict.headline)
})

test('percentages are signed, rounded, and unbounded limits use an ellipsis', () => {
  const value = input()
  Object.assign(value.primary.comparisons[0]!, { lift: 0.124, ci: [null, 0.216] })
  expect(computeVerdict(value).finding).toBe('Shorter form is statistically better: +12% (CI … to +22%).')
  value.phaseKind = 'rollout'
  value.winnerLabel = 'Shorter form'
  value.exposures.perArm.find(item => item.kind === 'holdout')!.n = 1000
  Object.assign(value.primary.comparisons[0]!, { lift: -0.124, ci: [-0.216, null] })
  expect(computeVerdict(value).finding).toBe('Since shipping Shorter form: -12% vs the holdout (CI -22% to …).')
})

test('several better variants recommend the largest lift, independently of comparison order', () => {
  const value = input('T7-several')
  expect(computeVerdict(value).recommendedArm).toBe('variantB')
  value.primary.comparisons.reverse()
  expect(computeVerdict(value)).toEqual(snapshot('T7-several').verdict)
})

test.each(['T7', 'R3'])('%s guardrail warnings win over insufficient data', name => {
  const value = input(name)
  expect(computeVerdict(value).guardrailLine).toBe('No harm detected so far')
  value.guardrails.push({ name: 'Donations', status: 'insufficient' })
  expect(computeVerdict(value).guardrailLine).toBe('Too little data to rule out harm')
  value.guardrails.push({ name: 'Completed lessons', status: 'warning' })
  expect(computeVerdict(value).guardrailLine).toBe('Watch Completed lessons: trending worse.')
})

test('rollout minimum includes the holdout and conversions, and failing guardrails do not become test verdicts', () => {
  const value = input('R3')
  value.guardrails[0]!.status = 'failing'
  expect(computeVerdict(value)).toMatchObject({ row: 'R3', guardrailLine: 'Watch Completed lessons: trending worse.' })
  value.exposures.perArm.find(item => item.kind === 'holdout')!.n = 999
  expect(computeVerdict(value).row).toBe('R2')
  value.exposures.perArm.find(item => item.kind === 'holdout')!.n = 1000
  value.primary.converters = 149
  expect(computeVerdict(value).row).toBe('R2')
})

test('pure helpers have no runtime dependency edges', () => {
  for (const name of ['verdict', 'guardrails', 'decideGuard']) {
    const graph = collectImports(fileURLToPath(new URL(`../../src/results/${name}.ts`, import.meta.url)))
    expect(graph.bare).toEqual([])
    expect(graph.dynamic).toEqual([])
  }
})

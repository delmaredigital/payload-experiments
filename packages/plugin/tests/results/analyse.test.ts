import { describe, expect, test } from 'vitest'
import {
  abTestMoments, bonferroniAlpha, buildStatistic, capValues, createThetaAdjustedStatistics,
  effectBayesianABTest, sequentialOneSidedTreatmentGreaterTTest,
  sequentialOneSidedTreatmentLesserTTest, sequentialTwoSidedTTest, statisticVariance, summarizeUnits,
} from '@delmaredigital/experiments-stats'
import { analysePhase } from '../../src/results/analyse.js'
import type { AnalysePhaseInput, FrozenMetric } from '../../src/results/analyse.js'
import { outcomeStatistic } from '../../src/results/cuped.js'
import { guardrailStatus } from '../../src/results/guardrails.js'
import { validateSnapshot } from '../../src/results/snapshot.js'

function metric(overrides: Partial<FrozenMetric> = {}): FrozenMetric {
  return { metricId: 'primary', name: 'Completed lessons', kind: 'binomial', role: 'primary',
    direction: 'increase', attributionWindowHours: 168, minSampleSize: 10, ...overrides }
}
function example({ n = 2000, rate = 0.25, controlRate = 0.2, method = 'sequential', holdout = false, secondVariant = false }: {
  n?: number; rate?: number; controlRate?: number; method?: 'sequential' | 'bayesian'; holdout?: boolean; secondVariant?: boolean
} = {}): AnalysePhaseInput {
  const arms: AnalysePhaseInput['phase']['arms'][number][] = [
    { key: 'control', label: 'Original', kind: 'control', weight: secondVariant ? 30 : holdout ? 45 : 50 },
    { key: 'variantA', label: 'Shorter form', kind: 'variant', weight: secondVariant ? 30 : holdout ? 45 : 50 },
  ]
  if (secondVariant) arms.push({ key: 'variantB', label: 'Guided form', kind: 'variant', weight: 30 })
  if (holdout || secondVariant) arms.push({ key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 10 })
  const units = new Map<string, { arm: string; firstTs: string }>()
  const values = new Map<string, number>()
  for (const arm of arms) {
    const size = arm.kind === 'holdout' ? Math.round(n / (secondVariant ? 3 : 4.5)) : n
    for (let i = 0; i < size; i++) {
      const id = `${arm.key}-${i}`
      units.set(id, { arm: arm.key, firstTs: '2026-10-01T00:00:00Z' })
      values.set(id, i < size * (arm.kind === 'variant' ? rate : controlRate) ? 1 : 0)
    }
  }
  return { phase: { experiment: 'test', phase: 1, phaseKind: 'test', startedAt: '2026-10-01T00:00:00Z',
    arms, metricDefinitions: [metric()], analysis: { method, sequentialTuningParameter: 5000,
      cuped: 'auto', plannedDurationDays: 30, minExposuresPerArm: 200 } },
    status: 'running', now: '2026-10-15T00:00:00Z', units, metricData: [{ metricId: 'primary', values }] }
}
function direct(input: AnalysePhaseInput, arm = 'variantA') {
  const data = input.metricData[0]!
  const values = (key: string) => [...input.units].filter(([, unit]) => unit.arm === key).map(([id]) => data.values.get(id) ?? 0)
  return [buildStatistic(input.phase.metricDefinitions[0]!.kind, summarizeUnits(values('control'))),
    buildStatistic(input.phase.metricDefinitions[0]!.kind, summarizeUnits(values(arm)))] as const
}

test('sequential primary matches direct raw and Bonferroni-adjusted stats; holdout is measured only', () => {
  const input = example({ secondVariant: true })
  const result = analysePhase(input)
  const [a, b] = direct(input)
  const raw = sequentialTwoSidedTTest(a, b, { alpha: 0.05, sequentialTuningParameter: 5000 })
  const adjusted = sequentialTwoSidedTTest(a, b, { alpha: bonferroniAlpha(0.05, 2), sequentialTuningParameter: 5000 })
  expect(result).toMatchObject({ winnerArm: null, minExposuresPerArm: 200, k: 2, alphaAdjusted: 0.025 })
  expect(result.metrics[0]!.comparisons[0]).toMatchObject({ lift: raw.expected, ci: raw.ci,
    ciAdjusted: adjusted.ci, pValue: raw.pValue, pValueAdjusted: Math.min(1, adjusted.pValue! * 2) })
  expect(result.metrics[0]!.perArm.map(group => group.arm)).toContain('holdout')
  expect(result.metrics[0]!.comparisons.map(group => group.arm)).toEqual(['variantA', 'variantB'])
  expect(result.srm.expected).toEqual({ control: .3, variantA: .3, variantB: .3, holdout: .1 })
  validateSnapshot(result)
})

test('secondaries are exploratory, use raw alpha and do not change primary verdict', () => {
  const input = example({ secondVariant: true })
  const before = analysePhase(input)
  input.phase = { ...input.phase, metricDefinitions: [...input.phase.metricDefinitions, metric({ metricId: 'secondary', role: 'secondary' })] }
  input.metricData = [...input.metricData, { ...input.metricData[0]!, metricId: 'secondary' }]
  const result = analysePhase(input)
  expect(result.verdict).toEqual(before.verdict)
  expect(result.metrics[1]!.comparisons[0]!.ciAdjusted).toEqual(result.metrics[0]!.comparisons[0]!.ci)
  expect(result.metrics[1]!.comparisons[0]!.pValueAdjusted).toEqual(result.metrics[0]!.comparisons[0]!.pValue)
})

test.each(['increase', 'decrease'] as const)('Bayesian %s matches the frozen prior and direct inverse test; risk is display only', direction => {
  const input = example({ method: 'bayesian' })
  const prior = { mean: -.01, variance: .1, proper: true }
  input.phase = { ...input.phase, metricDefinitions: [metric({ direction })], analysis: { ...input.phase.analysis, prior, bayesian: { ctw: .95, risk: 0 } } }
  const [a, b] = direct(input)
  const expected = effectBayesianABTest(a, b, { alpha: .05, priorEffect: prior, inverse: direction === 'decrease' })
  const result = analysePhase(input)
  expect(result.metrics[0]!.comparisons[0]).toMatchObject({ chanceToWin: expected.chanceToWin,
    risk: expected.risk[1], lift: expected.expected, ci: expected.ci, ciAdjusted: expected.ci,
    significant: direction === 'increase' ? 'better' : 'worse' })
  expect(result.params.prior).toEqual(prior)
})

test('CUPED reduces correlated outcome variance through the stats engine and skips absent, constant or disabled pre data', () => {
  const input = example({ n: 400 })
  input.phase = { ...input.phase, metricDefinitions: [metric({ kind: 'revenue' })] }
  const values = new Map<string, number>(); const covariates = new Map<string, number>()
  for (const [id, unit] of input.units) {
    const i = Number(id.split('-')[1]); const pre = i % 20 + 10
    covariates.set(id, pre); values.set(id, pre * 2 + i % 3 + (unit.arm === 'variantA' ? 2 : 0))
  }
  input.metricData = [{ metricId: 'primary', values, covariates }]
  const rows = (arm: string, map: Map<string, number>) => [...input.units].filter(([, unit]) => unit.arm === arm).map(([id]) => map.get(id)!)
  const a = outcomeStatistic('revenue', rows('control', values), rows('control', covariates)).statistic
  const b = outcomeStatistic('revenue', rows('variantA', values), rows('variantA', covariates)).statistic
  const pair = createThetaAdjustedStatistics(a, b)
  expect(statisticVariance(pair[0])).toBeLessThan(statisticVariance(direct(input)[0]))
  const result = analysePhase(input)
  expect(result.metrics[0]!.cupedApplied).toBe(true)
  expect(result.metrics[0]!.comparisons[0]!.ci).toEqual(sequentialTwoSidedTTest(...pair, { sequentialTuningParameter: 5000 }).ci)
  expect(abTestMoments(...pair).standardError).toBeLessThan(abTestMoments(...direct(input)).standardError)
  for (const pre of [undefined, new Map<string, number>(), new Map([...covariates].map(([id]) => [id, 1]))]) {
    input.metricData = [{ metricId: 'primary', values, covariates: pre }]
    expect(analysePhase(input).metrics[0]!.cupedApplied).toBe(false)
  }
  input.metricData = [{ metricId: 'primary', values, covariates }]
  input.phase.analysis.cuped = 'off'
  expect(analysePhase(input).metrics[0]!.cupedApplied).toBe(false)
})

test('revenue caps apply to outcomes and pre-period values, preserving uncapped totals and counts', () => {
  const input = example({ n: 100 })
  input.phase = { ...input.phase, metricDefinitions: [metric({ kind: 'revenue', capping: { type: 'absolute', value: 5 }, resolvedCap: 5 })] }
  const values = new Map([...input.units].map(([id], i) => [id, i % 10]))
  input.metricData = [{ metricId: 'primary', values, covariates: values }]
  const result = analysePhase(input)
  const capped = capValues([...values.values()].slice(0, 100), 5)
  expect(result.metrics[0]!.perArm[0]).toMatchObject({ sum: capped.cappedTotal,
    capped: { resolvedCap: 5, uncappedTotal: capped.uncappedTotal, cappedCount: capped.cappedCount },
    covariate: { preSum: capped.cappedTotal } })
  expect(result.exposures.capped.primary).toBe(capped.cappedCount * 2)
  expect(result.params.caps.primary).toEqual({ type: 'absolute', value: 5, resolvedCap: 5 })
})

test.each(['count', 'binomial'] as const)('%s is never capped', kind => {
  const input = example()
  input.phase = { ...input.phase, metricDefinitions: [metric({ kind, capping: { type: 'absolute', value: .1 }, resolvedCap: .1 })] }
  const result = analysePhase(input)
  expect(result.exposures.capped.primary).toBe(0)
  expect(result.params.caps).toEqual({})
  expect(result.metrics[0]!.perArm[0]!.sum).toBe(400)
})

test('rollout compares the shipped arm with holdout and carries its own weights and minimum', () => {
  const input = example()
  input.phase = { ...input.phase, phase: 2, phaseKind: 'rollout', arms: [
    { key: 'variantA', label: 'Shorter form', kind: 'variant', weight: 90 },
    { key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 10 },
  ] }
  input.units = new Map([...input.units].filter(([id, unit]) => unit.arm === 'variantA' || Number(id.split('-')[1]) % 9 === 0)
    .map(([id, unit]) => [id, { ...unit, arm: unit.arm === 'control' ? 'holdout' : unit.arm }]))
  input.status = 'decided'; input.winnerArm = 'variantA'
  const result = analysePhase(input)
  const a = buildStatistic('binomial', summarizeUnits([...input.units].filter(([, unit]) => unit.arm === 'holdout').map(([id]) => input.metricData[0]!.values.get(id)!)))
  const b = direct(example())[1]
  expect(result).toMatchObject({ winnerArm: 'variantA', k: 1, alphaAdjusted: .05, minExposuresPerArm: 200,
    srm: { flagged: false, expected: { variantA: .9, holdout: .1 } }, verdict: { row: 'R3' } })
  expect(result.metrics[0]!.comparisons[0]!.ci).toEqual(sequentialTwoSidedTTest(a, b, { sequentialTuningParameter: 5000 }).ci)
  expect(result.power.daysRemaining).toBeNull()
  delete input.winnerArm
  expect(() => analysePhase(input)).toThrow(/shipped arm/)
})

test('SRM, multi-arm share, mismatch and identity diagnostics use exposures only', () => {
  const input = example()
  input.excludedMultiArm = 41; input.armMismatch = 7; input.identityConflictShare = .2
  let result = analysePhase(input)
  expect(result.exposures).toMatchObject({ total: 4000, excludedMultiArm: 41, multiArmShare: 41 / 4041, armMismatch: 7, identityConflictShare: .2 })
  expect(result.verdict.code).toBe('data-problem')
  input.excludedMultiArm = 0
  expect(analysePhase(input).verdict.code).not.toBe('data-problem')
  input.units = new Map([...input.units].filter(([id, unit]) => unit.arm === 'control' || Number(id.split('-')[1]) < 20))
  result = analysePhase(input)
  expect(result.srm.flagged).toBe(true)
  expect(result.verdict.code).toBe('data-problem')
})

test('empty, zero variance, source errors and invalid values never claim a result or guardrail safety', () => {
  const input = example({ n: 0 })
  expect(analysePhase(input)).toMatchObject({ verdict: { code: 'collecting' }, exposures: { total: 0 }, srm: { p: 1 } })
  input.phase = { ...input.phase, metricDefinitions: [metric(), metric({ metricId: 'guard', role: 'guardrail' })] }
  input.metricData = [{ metricId: 'primary', values: new Map(), unavailable: 'Offline' }]
  expect(analysePhase(input)).toMatchObject({ verdict: { code: 'unavailable' }, guardrails: [{ metricId: 'guard', status: 'insufficient' }] })
  const invalid = example()
  const values = new Map(invalid.metricData[0]!.values); values.set('control-0', NaN)
  invalid.metricData = [{ metricId: 'primary', values }]
  expect(analysePhase(invalid).metrics[0]!.unavailable).toMatch(/finite/)
  const zeros = example({ rate: 0, controlRate: 0 })
  expect(analysePhase(zeros).metrics[0]!.comparisons[0]).toMatchObject({ ci: [null, null], significant: 'none' })
})

test('window and computedAt use injected now, endedAt freezes the analysis window; input is not mutated', () => {
  const input = example()
  input.phase.endedAt = '2026-10-10T00:00:00Z'
  const before = structuredClone(input)
  const result = analysePhase(input)
  expect(result.window.to).toBe('2026-10-10T00:00:00.000Z')
  expect(result.computedAt).toBe('2026-10-15T00:00:00.000Z')
  expect(input).toEqual(before)
})

// Explicit per-cell unit-data fixtures, passed through real stats functions.
const guardrailCases = {
  sequential: { failing: { rate: .1, n: 20000 }, ok: { rate: .22, n: 20000 }, warning: { rate: .195, n: 2000 }, insufficient: { rate: .2, n: 2000 } },
  bayesian: { failing: { rate: .1, n: 20000 }, ok: { rate: .22, n: 20000 }, warning: { rate: .19, n: 2000 }, insufficient: { rate: .2, n: 2000 } },
} as const
for (const method of ['sequential', 'bayesian'] as const) {
  for (const direction of ['increase', 'decrease'] as const) {
    describe(`guardrails: ${method}, ${direction}`, () => {
      test.each(['failing', 'ok', 'warning', 'insufficient'] as const)('%s uses the required uncorrected bounds and own converter minimum', expectedStatus => {
        const fixture = guardrailCases[method][expectedStatus]
        const rate = direction === 'increase' ? fixture.rate : .4 - fixture.rate
        const input = example({ n: fixture.n, rate, method })
        input.phase = { ...input.phase, metricDefinitions: [metric(), metric({ metricId: 'guard', role: 'guardrail', direction, guardrailThreshold: .05 })] }
        input.metricData = [...input.metricData, { ...input.metricData[0]!, metricId: 'guard' }]
        const [a, b] = direct(input)
        const lower = sequentialOneSidedTreatmentGreaterTTest(a, b, { alpha: .05, sequentialTuningParameter: 5000 }).ci[0]
        const upper = sequentialOneSidedTreatmentLesserTTest(a, b, { alpha: .05, sequentialTuningParameter: 5000 }).ci[1]
        const bayes = effectBayesianABTest(a, b, { alpha: .10, inverse: direction === 'decrease' })
        const n = Math.min(...analysePhase(input).metrics[1]!.perArm.map(group => group.converters))
        const directStatus = guardrailStatus({ method, direction, n, minSampleSize: 10, threshold: .05,
          pointEstimate: sequentialTwoSidedTTest(a, b).expected,
          lowerBound: method === 'sequential' ? lower : bayes.ci[0],
          upperBound: method === 'sequential' ? upper : bayes.ci[1], pWorse: 1 - bayes.chanceToWin })
        expect(directStatus).toBe(expectedStatus)
        expect(analysePhase(input).guardrails).toEqual([{ metricId: 'guard', status: expectedStatus }])
      })
    })
  }
}

test('guardrail failure requires both compared groups to meet its own conversion minimum', () => {
  const input = example({ rate: .1, n: 20000 })
  input.phase = { ...input.phase, metricDefinitions: [metric(), metric({ metricId: 'guard', role: 'guardrail', minSampleSize: 3000 })] }
  input.metricData = [...input.metricData, { ...input.metricData[0]!, metricId: 'guard' }]
  expect(analysePhase(input).guardrails[0]!.status).toBe('warning')
})

test('a failing guardrail carries the worse arm key in a two-variant test', () => {
  const n = 20000
  const input = example({ n, secondVariant: true })
  input.phase = { ...input.phase, metricDefinitions: [metric(), metric({ metricId: 'guard', role: 'guardrail' })] }
  const values = new Map([...input.units].map(([id, unit]) => [id,
    Number(id.split('-')[1]) < (unit.arm === 'variantB' ? n * .1 : n * .2) ? 1 : 0,
  ]))
  input.metricData = [...input.metricData, { metricId: 'guard', values }]
  const result = analysePhase(input)
  expect(result.guardrails).toEqual([{ metricId: 'guard', status: 'failing' }])
  expect(result.verdict).toMatchObject({ row: 3, code: 'guardrail-failing', worstArm: 'variantB',
    finding: 'Stop: Guided form harms Completed lessons.' })
})

test('running collecting snapshots have power for the separate line, row 9 uses it in the headline; stopped/decided tests omit it', () => {
  const input = example({ rate: .2 })
  input.phase.analysis.minExposuresPerArm = 3000
  const collecting = analysePhase(input)
  expect(collecting.verdict.row).toBe(4)
  expect(collecting.power.daysRemaining).not.toBeNull()
  expect(collecting.params.bayesian.risk).toBe(.0125)
  input.phase.analysis.minExposuresPerArm = 200
  const inconclusive = analysePhase(input)
  expect(inconclusive.verdict.row).toBe(9)
  expect(inconclusive.power).toEqual(collecting.power)
  for (const status of ['stopped', 'decided'] as const) {
    input.status = status
    expect(analysePhase(input).power.daysRemaining).toBeNull()
  }
})

test('frozen analysis windows, guardrail thresholds and per-metric minimums override document defaults', () => {
  const input = example({ rate: .1, n: 20000 })
  input.phase = { ...input.phase,
    analysis: { ...input.phase.analysis, attributionWindowHours: 24,
      minSampleSizes: { primary: 5000, guard: 3000 }, guardrailThresholds: { guard: .1 } },
    metricDefinitions: [metric(), metric({ metricId: 'guard', role: 'guardrail', guardrailThreshold: .05 })],
  }
  input.metricData = [...input.metricData, { ...input.metricData[0]!, metricId: 'guard' }]
  expect(analysePhase(input)).toMatchObject({
    params: { attributionWindows: { primary: 24, guard: 24 }, minSampleSizes: { primary: 5000, guard: 3000 }, guardrailThresholds: { guard: .1 } },
    guardrails: [{ metricId: 'guard', status: 'warning' }], verdict: { code: 'collecting' },
  })
})

test.each(['sequential', 'bayesian'] as const)('%s passes frozen primary direction through for lower-is-better row-7 and row-8 recommendations', method => {
  const n = 5000
  const input = example({ n, secondVariant: true, method })
  input.phase = { ...input.phase, metricDefinitions: [metric({ direction: 'decrease' })] }
  const values = new Map(input.metricData[0]!.values)
  for (let i = 0; i < n; i++) {
    values.set(`variantA-${i}`, i < 800 ? 1 : 0)
    values.set(`variantB-${i}`, i < 480 ? 1 : 0)
  }
  input.metricData = [{ metricId: 'primary', values }]
  const result = analysePhase(input)
  expect(result.verdict).toMatchObject({ row: 7, recommendedArm: 'variantB' })
  expect(result.verdict.finding).toContain('Guided form has the larger improvement')
  expect(result.metrics[0]!.comparisons[0]!.lift).toBeCloseTo(-.2)
  expect(result.metrics[0]!.comparisons[1]!.lift).toBeCloseTo(-.52)
  input.phase = { ...input.phase, arms: [
    ...input.phase.arms.filter(arm => arm.kind !== 'holdout').map(arm => ({ ...arm, weight: 25 })),
    { key: 'variantC', kind: 'variant', label: 'One-page form', weight: 25 },
  ] }
  const units = new Map([...input.units].filter(([, unit]) => unit.arm !== 'holdout'))
  for (let i = 0; i < n; i++) {
    const id = `variantC-${i}`
    units.set(id, { arm: 'variantC', firstTs: '2026-10-01T00:00:00Z' })
    values.set(id, i < 1250 ? 1 : 0)
  }
  input.units = units
  expect(analysePhase(input).verdict).toMatchObject({ row: 8, recommendedArm: 'variantB' })
})

test('P2: adjusted sequential p-value uses the alpha/k test and agrees with the adjusted interval', () => {
  const input = example({ n: 5000, rate: 1145 / 5000, controlRate: 1000 / 5000, secondVariant: true })
  const result = analysePhase(input)
  const [a, b] = direct(input)
  const raw = sequentialTwoSidedTTest(a, b, { alpha: .05, sequentialTuningParameter: 5000 })
  const adjusted = sequentialTwoSidedTTest(a, b, { alpha: .025, sequentialTuningParameter: 5000 })
  const comparison = result.metrics[0]!.comparisons[0]!
  expect(raw.pValue! * 2).toBeLessThan(.05)
  expect(comparison.pValueAdjusted).toBe(Math.min(1, adjusted.pValue! * 2))
  expect(comparison.ciAdjusted).toEqual(adjusted.ci)
  expect(comparison.ciAdjusted[0]).toBeLessThanOrEqual(0)
  expect(comparison.ciAdjusted[1]).toBeGreaterThanOrEqual(0)
  expect(comparison.pValueAdjusted).toBeGreaterThanOrEqual(.05)
  expect(comparison.significant).toBe('none')
})

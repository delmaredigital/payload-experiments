import { expect, test } from 'vitest'
import {
  armRows, cappedCell, collectingLine, dataQuality, defaultRound, guardrailChips,
  powerLine, rolloutLine, roundOptions, verdictCard, verdictLabel,
} from '../../../src/admin/results/results.model.js'
import { RESULTS_COPY } from '../../../src/admin/copy/results.js'
import { formatCI } from '../../../src/admin/results/format.js'
import { fixture, fixtures, makeSnapshot, phaseFor, revenueSnapshot } from './fixtures.js'

test.each(Object.keys(fixtures))('%s keeps the server headline verbatim', name => {
  const snapshot = fixture(name)
  expect(verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: 'Shorter form' })).toEqual({
    headline: snapshot.verdict.headline, detail: snapshot.verdict.detail,
    ...(snapshot.verdict.guardrailLine === undefined ? {} : { guardrailLine: snapshot.verdict.guardrailLine }),
  })
  expect(verdictLabel(snapshot)).toBeTruthy()
})
test.each(['T3', 'T5', 'T6', 'T8', 'T9'])('decided %s reads the pinned finding and detail without action wording', name => {
  const decisionSnapshot = fixture(name)
  const model = verdictCard({ snapshot: fixture('R3'), decisionSnapshot, isDecidedTestRound: true, winnerLabel: 'Original form' })
  expect(model).toEqual({ title: 'Decided: Original form', finding: decisionSnapshot.verdict.finding, detail: decisionSnapshot.verdict.detail })
  expect(model).not.toHaveProperty('action')
  expect(model).not.toHaveProperty('headline')
  if (decisionSnapshot.verdict.action) expect(JSON.stringify(model)).not.toContain(decisionSnapshot.verdict.action)
})
test('a missing pinned snapshot does not substitute the current finding', () => {
  expect(verdictCard({ snapshot: fixture('R3'), isDecidedTestRound: true, winnerLabel: 'Shorter form' }))
    .toEqual({ title: 'Decided: Shorter form', finding: null, detail: null })
})
test('absent guardrail line stays absent', () => {
  const snapshot = makeSnapshot({ guardrails: [] })
  expect(snapshot.verdict.guardrailLine).toBeDefined()
  delete snapshot.verdict.guardrailLine
  expect(verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: '' })).not.toHaveProperty('guardrailLine')
  expect(guardrailChips(snapshot)).toEqual([])
})

test('decided opens its test round; every other status opens the newest round', () => {
  const testPhase = phaseFor(fixture('T7'))
  const rollout = { ...phaseFor(fixture('R3')), phase: 3 }
  const phases = [rollout, testPhase, { ...testPhase, phase: 2 }]
  expect(defaultRound({ phases, status: 'decided', decision: { phase: 1 } })).toBe(1)
  for (const status of ['draft', 'running', 'stopped', 'archived'] as const) expect(defaultRound({ phases, status, decision: { phase: 1 } })).toBe(3)
  expect(defaultRound({ phases: [], status: 'draft' })).toBeNull()
  expect(roundOptions([testPhase, rollout])).toEqual([
    { value: 1, label: 'Round 1 · during the test' }, { value: 3, label: 'Round 3 · after shipping' },
  ])
})
test.each(Object.keys(fixtures))('%s rows keep round order and stored labels; holdout never has comparisons', name => {
  const snapshot = fixture(name)
  const phase = phaseFor(snapshot)
  phase.arms.reverse()
  const rows = armRows({ snapshot, phase, metricId: 'registrations' })
  expect(rows.map(row => row.key)).toEqual(phase.arms.map(arm => arm.key))
  expect(rows.map(row => row.label)).toEqual(phase.arms.map(arm => arm.label))
  const holdout = rows.find(row => row.key === 'holdout')!
  expect(holdout.baseline).toBe(snapshot.phaseKind === 'rollout' ? 'Holdout · baseline' : 'Measured, not compared')
  expect(holdout).not.toHaveProperty('comparison')
  if (snapshot.phaseKind === 'test') expect(rows.find(row => row.key === 'control')?.baseline).toBe('Original')
  else {
    const winner = rows.find(row => row.key !== 'holdout')!
    expect(winner).not.toHaveProperty('baseline')
    expect(winner.comparison !== undefined).toBe(snapshot.metrics[0]!.comparisons.some(comparison => comparison.arm === winner.key))
  }
})
test('sequential comparisons keep raw p separate and include adjusted values only for differing alpha', () => {
  const snapshot = fixture('T7-adjusted')
  const comparison = snapshot.metrics[0]!.comparisons[0]!
  comparison.pValue = 0.01
  comparison.pValueAdjusted = 0.03
  const row = armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })[1]!
  expect(row.comparison).toEqual({ method: 'sequential', lift: '+12.0%', ci: formatCI(comparison.ci), adjustedCI: formatCI(comparison.ciAdjusted), pValue: '0.01', pValueAdjusted: '0.03', significance: 'Better' })
  delete comparison.pValueAdjusted
  expect(armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })[1]!.comparison).toHaveProperty('pValue', '0.01')
  expect(armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })[1]!.comparison).not.toHaveProperty('pValueAdjusted')
  comparison.pValueAdjusted = 0.03
  snapshot.alphaAdjusted = snapshot.alpha
  expect(armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })[1]!.comparison).not.toHaveProperty('adjustedCI')
  expect(armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })[1]!.comparison).not.toHaveProperty('pValueAdjusted')
})
test('Bayesian results use stored chance to win, CI and risk', () => {
  const snapshot = fixture('T7-bayesian')
  const row = armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })[1]!
  expect(row.comparison).toEqual({ method: 'bayesian', chanceToWin: '97.8%', ci: formatCI(snapshot.metrics[0]!.comparisons[0]!.ci), risk: '—', significance: 'Better' })
  expect(row.comparison).not.toHaveProperty('pValue')
  expect(row.comparison).not.toHaveProperty('lift')
  snapshot.metrics[0]!.comparisons[0]!.risk = 0.002
  expect(armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })[1]!.comparison).toHaveProperty('risk', '0.2%')
})
test('several winners retain their own comparisons and server headline', () => {
  const snapshot = fixture('T7-several')
  const rows = armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })
  expect(rows.filter(row => row.comparison?.significance === 'Better').map(row => row.key)).toEqual(['variantA', 'variantB'])
  expect(verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: '' })).toHaveProperty('headline', snapshot.verdict.headline)
})
test('row 4 uses per-arm minima and excludes holdout', () => {
  const snapshot = fixture('T4')
  const input = { snapshot, phaseKind: snapshot.phaseKind, status: 'running' as const }
  expect(collectingLine(input, { minExposuresPerArm: 1000 })).toBe('360 of 1,000 people, 37 of 150 conversions')
  // The frozen minimum comes from the snapshot; a snapshot without one shows a dash, never inferred from prose.
  expect(collectingLine(input)).toBe('360 of 1,000 people, 37 of 150 conversions')
  const legacy = { ...snapshot, minExposuresPerArm: undefined as unknown as number }
  expect(collectingLine({ ...input, snapshot: legacy })).toBe('360 of — people, 37 of 150 conversions')
  const phase = phaseFor(snapshot)
  snapshot.metrics[0]!.perArm[0]!.converters = 20
  expect(collectingLine(input, { phase, minExposuresPerArm: 1000 })).toBe('360 of 1,000 people, 20 of 150 conversions')
})
test.each([
  [null, RESULTS_COPY.plannedEnd], [0, RESULTS_COPY.plannedEnd], [0.25, RESULTS_COPY.plannedEnd],
  [1, 'About 1 more day.'], [1.01, 'About 2 more days.'], [5, 'About 5 more days.'],
  [12.4, 'About 13 more days.'], [90, 'About 90 more days.'], [90.01, RESULTS_COPY.infeasible], [120, RESULTS_COPY.infeasible],
] as const)('collecting power days %s mirrors server copy', (daysRemaining, expected) => {
  const snapshot = fixture('T4')
  snapshot.power.daysRemaining = daysRemaining
  expect(powerLine({ snapshot, phaseKind: 'test', status: 'running' })).toBe(expected)
})
test('collecting power uses the server infeasible flag even without a days estimate', () => {
  const snapshot = fixture('T4')
  snapshot.power = { ...fixture('T9-infeasible').power, daysRemaining: null }
  expect(powerLine({ snapshot, phaseKind: 'test', status: 'running' })).toBe(RESULTS_COPY.infeasible)
})
test.each(Object.keys(fixtures))('%s only renders lines appropriate to its verdict and round', name => {
  const snapshot = fixture(name)
  const input = { snapshot, phaseKind: snapshot.phaseKind, status: name === 'T4-stopped' ? 'stopped' as const : snapshot.phaseKind === 'rollout' ? 'decided' as const : 'running' as const }
  expect(powerLine(input) !== null).toBe(name === 'T4')
  expect(collectingLine(input) !== null).toBe(['T4', 'T4-stopped', 'R2'].includes(name))
})
test.each(['draft', 'stopped', 'decided', 'archived'] as const)('collecting test power is absent when %s', status => {
  const snapshot = fixture('T4')
  expect(powerLine({ snapshot, phaseKind: 'test', status })).toBeNull()
})
test('a decided test round never offers power or collecting; a decided rollout can still collect', () => {
  const snapshot = fixture('T4')
  expect(collectingLine({ snapshot, phaseKind: 'test', status: 'decided' })).toBeNull()
  const rollout = fixture('R2')
  expect(collectingLine({ snapshot: rollout, phaseKind: 'rollout', status: 'decided' }, { minExposuresPerArm: 1000 }))
    .toBe('360 of 1,000 people, 144 of 150 conversions')
  expect(powerLine({ snapshot, phaseKind: 'rollout', status: 'running' })).toBeNull()
})
test.each(['R1', 'R2', 'R3'])('%s rollout is winner vs holdout with a shipping label and no Decide wording', name => {
  const snapshot = fixture(name)
  const phase = phaseFor(snapshot)
  expect(armRows({ snapshot, phase, metricId: 'registrations' }).map(row => row.key)).toEqual(['variantA', 'holdout'])
  expect(rolloutLine(snapshot, phase, [phase], { winnerArm: 'variantA' })).toBe('Since shipping Shorter form')
  expect(rolloutLine({ ...snapshot, winnerArm: 'holdout' }, phase, [phase], { winnerArm: 'variantA' })).toBe('Since shipping Unchanged form')
  expect(JSON.stringify(verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: '' }))).not.toMatch(/\bDecide\b/)
})
test('only the newest rollout borrows the current decision winner, regardless of phase list order', () => {
  const snapshot = fixture('R3')
  const older = phaseFor(snapshot)
  const newer = { ...older, phase: older.phase + 2 }
  const testPhase = { ...phaseFor(fixture('T7')), phase: newer.phase + 1 }
  const phases = [newer, testPhase, older]
  const unnamed = { ...snapshot, winnerArm: null }
  expect(rolloutLine(unnamed, older, phases, { winnerArm: 'variantB' })).toBe('Since shipping the winner')
  expect(rolloutLine({ ...unnamed, phase: newer.phase }, newer, phases, { winnerArm: 'variantA' })).toBe('Since shipping Shorter form')
  expect(rolloutLine({ ...snapshot, winnerArm: 'variantA' }, older, phases, { winnerArm: 'variantB' })).toBe('Since shipping Shorter form')
  expect(rolloutLine(unnamed, older, [])).toBe('Since shipping the winner')
  expect(rolloutLine(fixture('T7'), testPhase, phases)).toBeNull()
})
test('a shipped Original carries its rollout comparison against holdout', () => {
  const snapshot = fixture('R3')
  const phase = phaseFor(snapshot)
  phase.arms[0] = { key: 'control', kind: 'control', label: 'Original form' }
  snapshot.metrics[0]!.comparisons[0]!.arm = 'control'
  const row = armRows({ snapshot, phase, metricId: 'registrations' })[0]!
  expect(row).not.toHaveProperty('baseline')
  expect(row.comparison).toBeDefined()
})

test('capped cells always show the stored mean, uncapped total, zero count and frozen cap', () => {
  const snapshot = revenueSnapshot()
  const metric = snapshot.metrics[0]!
  const arm = metric.perArm[0]!
  arm.capped!.resolvedCap = 999 // The phase's frozen params are the display source.
  expect(cappedCell({ metric, arm, caps: snapshot.params.caps })).toEqual({ statistic: '$12.50', totalLine: 'Total $12,345.00 (not capped)', cappedLine: '0 capped at $100.00' })
  arm.capped!.cappedCount = 17
  expect(cappedCell({ metric, arm, caps: snapshot.params.caps }).cappedLine).toBe('17 capped at $100.00')
  const count = { ...metric, kind: 'count' as const }
  expect(cappedCell({ metric: count, arm, caps: snapshot.params.caps })).toEqual({ statistic: '12.5' })
})
test('uncapped notice reads null from frozen params or the pre-snapshot round', () => {
  const snapshot = revenueSnapshot()
  const metric = snapshot.metrics[0]!
  const arm = metric.perArm[0]!
  delete arm.capped
  snapshot.params.caps.gifts!.resolvedCap = null
  expect(cappedCell({ metric, arm, caps: snapshot.params.caps })).toEqual({ statistic: '$12.50', notice: RESULTS_COPY.noCap })
  expect(cappedCell({ metric: { ...metric, capNotice: 'no-history' } })).toEqual({ statistic: '—', notice: RESULTS_COPY.noCap })
})
test('guardrails use names and words for every stored status', () => {
  const snapshot = fixture('T7')
  snapshot.guardrails = (['failing', 'ok', 'warning', 'insufficient'] as const).map(status => ({ metricId: 'completed-lessons', status }))
  expect(guardrailChips(snapshot)).toEqual(['Failing', 'OK', 'Watch', 'Too little data'].map(status => ({ name: 'Completed lessons', status })))
})
test('data quality keeps all diagnostics separate with a next step and traffic shares', () => {
  const snapshot = fixture('T4')
  snapshot.srm.flagged = true
  snapshot.exposures.excludedMultiArm = 8
  snapshot.exposures.multiArmShare = 0.01
  snapshot.exposures.armMismatch = 3
  snapshot.exposures.identityConflictShare = 0.02
  snapshot.metrics[0]!.unavailable = 'Source timed out'
  const items = dataQuality(snapshot, { phase: phaseFor(snapshot), minExposuresPerArm: 1000, inLayer: true, layerSlices: [1, 2], allocation: 50 })
  expect(items.map(item => item.id)).toEqual(['srm', 'multi-group', 'mismatch', 'identity', 'too-few', 'layer', 'metric-registrations'])
  expect(items.every(item => item.nextStep.length > 0)).toBe(true)
  expect(items[0]!.shares).toContain('Original form: expected 48.0%, observed 48.7%')
  expect(items.find(item => item.id === 'mismatch')).toMatchObject({ message: RESULTS_COPY.mismatch, detail: '3 ignored.' })
  expect(items.find(item => item.id === 'multi-group')?.detail).toBe('8 excluded (1.0%).')
  expect(items.find(item => item.id === 'identity')?.detail).toBe('2.0% with identity conflicts.')
})
test('layer notice needs layer membership and a shortfall; holdout does not trigger low exposure notice', () => {
  const snapshot = fixture('T7')
  expect(dataQuality(snapshot, { minExposuresPerArm: 1000, inLayer: false, layerSlices: 0, allocation: 50 })).toEqual([])
  expect(dataQuality(snapshot, { inLayer: true, layerSlices: 50, allocation: 50 })).toEqual([])
  expect(dataQuality(snapshot, { inLayer: true, layerSlices: 49, allocation: 50 }).map(item => item.id)).toEqual(['layer'])
})
test('SRM shares use only the expected groups, excluding other exposure counts and totals', () => {
  const snapshot = fixture('T2')
  snapshot.srm.expected = { control: 0.5, variantA: 0.5 }
  snapshot.exposures.perArm = { control: 60, variantA: 40, holdout: 100 }
  snapshot.exposures.total = 250
  expect(dataQuality(snapshot, { phase: phaseFor(snapshot) }).find(item => item.id === 'srm')?.shares).toEqual([
    'Original form: expected 50.0%, observed 60.0%', 'Shorter form: expected 50.0%, observed 40.0%',
  ])
})
test.each(Object.keys(fixtures))('%s too-few diagnostic follows the frozen verdict without a threshold', name => {
  const snapshot = fixture(name)
  expect(dataQuality(snapshot).some(item => item.id === 'too-few')).toBe(['collecting', 'rollout-collecting'].includes(snapshot.verdict.code))
})
test('an unavailable metric with an empty error still has a diagnostic and next step', () => {
  const snapshot = fixture('T1')
  snapshot.metrics[0]!.unavailable = ''
  expect(dataQuality(snapshot)).toContainEqual({ id: 'metric-registrations', message: 'Registrations is unavailable: ', nextStep: RESULTS_COPY.unavailableNext })
})

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
  const rows = armRows({ snapshot, phase, metricId: 'registrations' })
  expect(rows.map(row => row.label)).toEqual(phase.arms.map(arm => arm.label))
  const holdout = rows.find(row => row.key === 'holdout')!
  expect(holdout.baseline).toBe('Measured, not compared')
  expect(holdout).not.toHaveProperty('comparison')
  if (snapshot.phaseKind === 'test') expect(rows.find(row => row.key === 'control')?.baseline).toBe('Original')
})
test('sequential comparisons show raw and adjusted CI only for differing alpha, and prefer adjusted p', () => {
  const snapshot = fixture('T7-adjusted')
  const comparison = snapshot.metrics[0]!.comparisons[0]!
  comparison.pValue = 0.01
  comparison.pValueAdjusted = 0.03
  const row = armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })[1]!
  expect(row.comparison).toEqual({ method: 'sequential', lift: '+12.0%', ci: formatCI(comparison.ci), adjustedCI: formatCI(comparison.ciAdjusted), pValue: '0.03', significance: 'Better' })
  delete comparison.pValueAdjusted
  expect(armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })[1]!.comparison).toHaveProperty('pValue', '0.01')
  snapshot.alphaAdjusted = snapshot.alpha
  expect(armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })[1]!.comparison).not.toHaveProperty('adjustedCI')
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
  expect(collectingLine(snapshot, { minExposuresPerArm: 1000 })).toBe('360 of 1,000 people, 37 of 150 conversions')
  // The exposure minimum is not on today's wire type: never infer it from prose.
  expect(collectingLine(snapshot)).toBe('360 of — people, 37 of 150 conversions')
  const phase = phaseFor(snapshot)
  snapshot.metrics[0]!.perArm[0]!.converters = 20
  expect(collectingLine(snapshot, { phase, minExposuresPerArm: 1000 })).toContain('20 of 150 conversions')
  expect(collectingLine(fixture('T7'))).toBeNull()
})
test.each([0, null, 5])('power days %s has prescribed copy', daysRemaining => {
  expect(powerLine({ ...fixture('T7').power, daysRemaining, exposuresNeededPerArm: null })).toBe(daysRemaining === 5 ? 'About 5 more days.' : RESULTS_COPY.plannedEnd)
})
test('infeasible power uses the server flag', () => {
  expect(powerLine(fixture('T9-infeasible').power)).toBe(RESULTS_COPY.infeasible)
})
test('a positive fractional day is not rounded to zero days', () => {
  expect(powerLine({ ...fixture('T7').power, daysRemaining: 0.25 })).toBe('About 0.25 more days.')
})
test.each(['R1', 'R2', 'R3'])('%s rollout is winner vs holdout with a shipping label and no Decide wording', name => {
  const snapshot = fixture(name)
  const phase = phaseFor(snapshot)
  expect(armRows({ snapshot, phase, metricId: 'registrations' }).map(row => row.key)).toEqual(['variantA', 'holdout'])
  expect(rolloutLine(snapshot, phase, { winnerArm: 'variantA' })).toBe('Since shipping Shorter form')
  expect(rolloutLine({ ...snapshot, winnerArm: 'holdout' }, phase, { winnerArm: 'variantA' })).toBe('Since shipping Unchanged form')
  expect(JSON.stringify(verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: '' }))).not.toMatch(/\bDecide\b/)
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
test('an unavailable metric with an empty error still has a diagnostic and next step', () => {
  const snapshot = fixture('T1')
  snapshot.metrics[0]!.unavailable = ''
  expect(dataQuality(snapshot)).toContainEqual({ id: 'metric-registrations', message: 'Registrations is unavailable: ', nextStep: RESULTS_COPY.unavailableNext })
})

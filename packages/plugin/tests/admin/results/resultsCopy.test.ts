import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import * as copy from '../../../src/admin/copy/results.js'
import { armRows, cappedCell, collectingLine, dataQuality, guardrailChips, powerLine, rolloutLine, roundOptions, verdictCard, verdictLabel } from '../../../src/admin/results/results.model.js'
import { fixture, fixtures, phaseFor, revenueSnapshot } from './fixtures.js'

function userWords(value: unknown): void {
  if (typeof value === 'string') expect(value).not.toMatch(/\b(arms?|phases?)\b/i)
  else if (value && typeof value === 'object') Object.values(value).forEach(userWords)
}
test('results copy uses group and round vocabulary, including string templates', () => {
  userWords(copy)
  expect(readFileSync(new URL('../../../src/admin/copy/results.ts', import.meta.url), 'utf8')).not.toMatch(/\b(arms?|phases?)\b/i)
})
test.each(Object.keys(fixtures))('%s model outputs use user vocabulary', name => {
  const snapshot = fixture(name)
  const phase = phaseFor(snapshot)
  userWords(verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: 'Shorter form' }))
  userWords(verdictCard({ snapshot, decisionSnapshot: snapshot, isDecidedTestRound: true, winnerLabel: 'Shorter form' }))
  userWords(armRows({ snapshot, phase, metricId: 'registrations' }))
  userWords(roundOptions([phase]))
  userWords(guardrailChips(snapshot))
  const input = { snapshot, phaseKind: snapshot.phaseKind, status: snapshot.phaseKind === 'rollout' ? 'decided' as const : 'running' as const }
  userWords(powerLine(input))
  userWords(collectingLine(input))
  userWords(rolloutLine(snapshot, phase, [phase], { winnerArm: 'variantA' }))
  userWords(verdictLabel(snapshot))
  snapshot.exposures.armMismatch = 1
  snapshot.exposures.identityConflictShare = 0.01
  userWords(dataQuality(snapshot, { phase, inLayer: true, layerSlices: 0, allocation: 50, minExposuresPerArm: 1000 }))
})
test('capped copy includes totals, zero capped observations, and no-history notice', () => {
  const snapshot = revenueSnapshot()
  userWords(cappedCell({ metric: snapshot.metrics[0]!, arm: snapshot.metrics[0]!.perArm[0], caps: snapshot.params.caps }))
  userWords(cappedCell({ metric: { metricId: 'gifts', kind: 'revenue', capNotice: 'no-history' } }))
})

import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import { assembleSnapshot } from '../../../src/results/snapshot.js'
import * as legacy from '../../../src/testSurface/results/legacy.js'
import * as display from '../../../src/testSurface/results/results.model.js'
import { isLegacySnapshot, type LegacySnapshot } from '../../../src/testSurface/results/snapshot.js'
import { RESULTS_COPY } from '../../../src/testSurface/copy/results.js'
import { recommendation } from '../../../src/testSurface/surface/results/recommendation.model.js'
import { fixture, fixtures, legacyFixture, phaseFor } from './fixtures.js'

afterEach(() => vi.restoreAllMocks())

test.each(Object.keys(fixtures))('latest writer shape %s never takes a fallback in any display function', name => {
  // The CORE-13 JSON fixtures are pinned by tests/results/snapshot.test.ts;
  // assembleSnapshot is the current writer's validated pure/I/O boundary.
  const snapshot = assembleSnapshot(fixture(name))
  expect(isLegacySnapshot(snapshot)).toBe(false)
  const spies = Object.keys(legacy).map(key => vi.spyOn(legacy, key as keyof typeof legacy))
  const phase = phaseFor(snapshot)
  const phases = [phase]
  const minimumRead = vi.fn(() => { throw new Error('Current snapshots must not read the context minimum') })
  const ctx = { phase, status: 'decided', get minExposuresPerArm(): number { return minimumRead() } }
  const input = { snapshot, phaseKind: snapshot.phaseKind, status: snapshot.phaseKind === 'test' ? 'running' as const : 'decided' as const }
  display.defaultRound({ phases, status: 'decided', decision: { phase: phase.phase } })
  display.roundOptions(phases)
  display.verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: 'Unused live label' })
  display.verdictCard({ snapshot, decisionSnapshot: snapshot, isDecidedTestRound: true, winnerLabel: 'Stored decision label' })
  expect(display.rolloutLine(snapshot, phase, phases, { winnerArm: 'variantB' }))
    .toBe(snapshot.phaseKind === 'rollout' ? 'Since shipping Shorter form' : null)
  for (const metric of snapshot.metrics) {
    display.armRows({ snapshot, phase, metricId: metric.metricId })
    for (const arm of metric.perArm) display.cappedCell({ metric, arm, caps: snapshot.params.caps })
  }
  display.guardrailChips(snapshot)
  display.powerLine(input)
  expect(display.collectingLine(input, ctx)).toBe(name === 'R2' ? '360 of 1,000 people, 144 of 150 conversions' : null)
  display.dataQuality(snapshot, ctx)
  display.verdictLabel(snapshot)
  recommendation({ snapshot, phase, status: input.status })
  for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  expect(minimumRead).not.toHaveBeenCalled()
  // A populated current snapshot cannot exercise a dormant ?? fallback. Also
  // forbid that source dependency so the requested mutation cannot hide in it.
  const model = readFileSync(new URL('../../../src/testSurface/results/results.model.ts', import.meta.url), 'utf8')
  expect(model).not.toContain('ctx.minExposuresPerArm')
})

test.each(['winnerArm', 'minExposuresPerArm'] as const)('guard detects %s alone missing', field => {
  const snapshot: LegacySnapshot = field === 'winnerArm'
    ? { ...fixture('R2'), winnerArm: undefined } : { ...fixture('R2'), minExposuresPerArm: undefined }
  delete snapshot[field]
  expect(isLegacySnapshot(snapshot)).toBe(true)
})

test('a stored null winner alone does not identify legacy history', () => {
  expect(isLegacySnapshot(fixture('T7'))).toBe(false)
  expect(isLegacySnapshot({ ...fixture('R3'), winnerArm: null })).toBe(false)
  expect(isLegacySnapshot(legacyFixture('R3'))).toBe(true)
})

test('legacy collecting keeps the old dash or context minimum', () => {
  const snapshot = legacyFixture('R2')
  const input = { snapshot, phaseKind: snapshot.phaseKind, status: 'decided' as const }
  expect(display.collectingLine(input)).toBe('360 of — people, 144 of 150 conversions')
  expect(display.collectingLine(input, { minExposuresPerArm: 2000 })).toBe('360 of 2,000 people, 144 of 150 conversions')
  expect(display.collectingLine({ ...input, snapshot: { ...snapshot, minExposuresPerArm: 1000 } }, { minExposuresPerArm: 2000 }))
    .toBe('360 of 1,000 people, 144 of 150 conversions')
})

test('legacy shipping keeps the winner copy and the newest live decision fallback', () => {
  const snapshot = legacyFixture('R3')
  const phase = phaseFor(snapshot)
  expect(display.rolloutLine(snapshot, phase, [phase])).toBe('Since shipping the winner')
  expect(display.rolloutLine(snapshot, phase, [phase], { winnerArm: 'variantA' })).toBe('Since shipping Shorter form')
  expect(display.rolloutLine(snapshot, phase, [{ ...phase, phase: phase.phase + 1 }], { winnerArm: 'variantA' }))
    .toBe('Since shipping the winner')
})

test.each(['R2', 'R3'])('legacy %s recommendation keeps the recommended-arm and winner-copy fallbacks', name => {
  const snapshot = legacyFixture(name)
  snapshot.verdict.recommendedArm = 'variantA'
  expect(recommendation({ snapshot, phase: phaseFor(snapshot) })).toContain('Since shipping Shorter form:')
  snapshot.verdict.recommendedArm = null
  expect(recommendation({ snapshot, phase: phaseFor(snapshot) })).toContain('Since shipping the winner:')
})

// The writer refuses a rollout snapshot without a winner, so this covers damaged stored data only.
test('a decided current rollout with a null stored winner reports a data problem without borrowing a winner', () => {
  const snapshot = { ...fixture('R3'), winnerArm: null }
  const phase = phaseFor(snapshot)
  expect(isLegacySnapshot(snapshot)).toBe(false)
  expect(display.dataQuality(snapshot, { status: 'decided', phase })).toContainEqual({
    id: 'missing-winner', message: RESULTS_COPY.missingWinner, nextStep: RESULTS_COPY.missingWinnerNext,
  })
  expect(display.rolloutLine(snapshot, phase, [phase], { winnerArm: 'variantA' })).toBeNull()
  expect(recommendation({ snapshot, phase })).toBe(RESULTS_COPY.missingWinner)
  expect(JSON.stringify([
    display.dataQuality(snapshot, { status: 'decided', phase }),
    display.rolloutLine(snapshot, phase, [phase], { winnerArm: 'variantA' }), recommendation({ snapshot, phase }),
  ])).not.toContain('the winner')
})

test('a decided current test snapshot keeps its schema-required null winner without a data problem', () => {
  const snapshot = assembleSnapshot(fixture('T7'))
  expect(snapshot.winnerArm).toBeNull()
  expect(display.dataQuality(snapshot, { status: 'decided' })).toEqual([])
  expect(display.verdictCard({ snapshot, decisionSnapshot: snapshot, isDecidedTestRound: true, winnerLabel: 'Stored decision label' }))
    .toHaveProperty('title', 'Decided: Stored decision label')
})

test.each(Object.keys(fixtures))('legacy %s derives the too-few item from its frozen verdict', name => {
  const snapshot = legacyFixture(name)
  const items = display.dataQuality(snapshot)
  expect(items.some(item => item.id === 'too-few')).toBe(['collecting', 'rollout-collecting'].includes(snapshot.verdict.code))
  if (items.some(item => item.id === 'too-few')) expect(items).toContainEqual({
    id: 'too-few', message: RESULTS_COPY.tooFew, nextStep: RESULTS_COPY.tooFewNext,
  })
})

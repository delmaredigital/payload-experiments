import { expect, test } from 'vitest'
import { defaultArms } from '../../../../src/admin/arms/arms.model.js'
import { balanceWeight, durationSuggestion, exposureOptions, orderedVersions, trafficShares } from '../../../../src/admin/surface/test/testPage.model.js'
import { placementLine, slotReady } from '../../../../src/admin/surface/pageBlock/pageBlock.model.js'
import * as copy from '../../../../src/admin/copy/testPage.js'
import type { PreflightResult } from '../../../../src/types/endpoints.js'

const placements: PreflightResult['placements'] = [{ collection: 'pages', id: 1, title: 'Welcome', detail: 'Published', ok: true,
  slots: { control: 1, variantA: 0, variantB: 0, variantC: 0 } }]
const estimate = { weeks: 3, plannedDurationDays: 21, sequentialTuningParameter: 420, feasible: true }
const preflight: PreflightResult = { placements, checks: [], baseline: null, trafficPerDay: 50, estimate }

test('traffic shares normalise finite non-negative weights without changing the groups', () => {
  const arms = defaultArms('block')
  expect(trafficShares(arms)).toEqual([50, 50])
  expect(trafficShares(arms.map((arm, i) => ({ ...arm, weight: i ? 75 : 25 })))).toEqual([25, 75])
  expect(trafficShares(arms.map(arm => ({ ...arm, weight: NaN })))).toEqual([0, 0])
  expect(trafficShares(arms.map(arm => ({ ...arm, weight: -2 })))).toEqual([0, 0])
  expect(trafficShares([])).toEqual([])
  expect(orderedVersions([...arms].reverse()).map(row => [row.arm.key, row.index])).toEqual([['control', 1], ['variantA', 0]])
})
test('placement lines use the page title and publication detail', () => {
  expect(placementLine(placements[0]!)).toBe('On: Welcome (Published)')
  expect(placementLine({ ...placements[0]!, detail: 'Draft' })).toBe('On: Welcome (Draft)')
})
test('content readiness is per placement and slot; a holdout uses the Original', () => {
  const arms = defaultArms('block')
  expect(slotReady(placements[0]!, arms[0]!)).toBe(true)
  expect(slotReady(placements[0]!, arms[1]!)).toBe(false)
  expect(slotReady({ ...placements[0]!, slots: undefined }, arms[0]!)).toBe(false)
  expect(slotReady(placements[0]!, { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 })).toBe(true)
})
test('duration suggestions compare the estimate with the saved length', () => {
  expect(durationSuggestion(preflight, 28)).toEqual(estimate)
  expect(durationSuggestion(preflight, 21)).toBeNull()
  expect(durationSuggestion({ ...preflight, estimate: null }, 28)).toBeNull()
  expect(durationSuggestion(null, 28)).toBeNull()
  expect(durationSuggestion(preflight)).toEqual(estimate)
})
test('Advanced offers only policies valid for the kind', () => {
  expect(exposureOptions('block')).toEqual(['render', 'viewport'])
  expect(exposureOptions('page')).toEqual(['pageview'])
  expect(exposureOptions('flag')).toEqual(['manual'])
  expect(exposureOptions('code')).toEqual(['manual'])
})
test('editor copy avoids developer vocabulary outside Advanced', () => {
  function check(value: unknown): void {
    if (typeof value === 'string') expect(value).not.toMatch(/\b(?:arms?|phases?|flag point|unit type|CUPED|exposure policy)\b/i)
    else if (typeof value === 'object' && value) Object.values(value).forEach(check)
  }
  const { ADVANCED_COPY: _advanced, ...editor } = copy
  check(editor)
  check(copy.suggestedWeeks(3)); check(copy.weeksHint(28))
})

test('custom shares stay integer and sum to100 with stable proportional remainder order', () => {
  const arms = defaultArms('block')
  expect(balanceWeight(arms, 'control', 40).map(arm => arm.weight)).toEqual([40, 60])
  const three = [...arms, { ...arms[1]!, key: 'variantB' as const }]
  expect(balanceWeight(three, 'control', 35).map(arm => arm.weight)).toEqual([35, 33, 32])
  for (let weight = 0; weight <= 100; weight++) {
    const result = balanceWeight(three, 'variantA', weight)
    expect(result.reduce((sum, arm) => sum + arm.weight, 0)).toBe(100)
    expect(result.every(arm => Number.isInteger(arm.weight) && arm.weight >= 0)).toBe(true)
    expect(result[1]!.weight).toBe(weight)
  }
  expect(balanceWeight(arms.map(arm => ({ ...arm, weight: 0 })), 'control', 40).map(arm => arm.weight)).toEqual([40, 60])
  expect(balanceWeight(arms, 'control', NaN)).toBe(arms)
  expect(balanceWeight(arms, 'control', 101)).toBe(arms)
  expect(balanceWeight(arms, 'variantC', 40)).toBe(arms)
})
